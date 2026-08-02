import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD, ghContainedEnv } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, mergedRow, type PrHarness } from './ccdPrHelpers.js';
import { isFullLine, parsePrLines, phaseFor } from '../src/prstate.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prstate-'); });
afterEach(() => { h.cleanup(); });

/** A workspace plus one commit on its branch, so `ahead` is 1 and the tip is
 *  a real oid the binding check can be pointed at.
 *
 *  `makeGhRepo`, never `makeRepo`: `_gh_repo_slug` reads `remote.origin.url`
 *  and `makeRepo`'s is a local bare PATH, so every assertion below would read
 *  `{"phase":"unknown","reason":"no-remote"}` instead of the phase it names. */
const workspaceWithCommit = (project: string, slug: string): { wt: string; main: string; tip: string } => {
  const main = h.makeGhRepo(project);
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, slug);
  fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
  h.git(wt, 'add', 'f.txt');
  h.git(wt, 'commit', '-m', 'the work');
  return { wt, main, tip: h.git(wt, 'rev-parse', 'HEAD') };
};

const line = (out: string): Record<string, any> => JSON.parse(out.split('\n')[0]!);

describe('pr-state argv', () => {
  it('takes exactly one --session or --project flag pair', () => {
    expect(h.run('cmd_pr_state').code).toBe(1);
    expect(h.run('cmd_pr_state --session').code).toBe(1);
    expect(h.run('cmd_pr_state --branch x').code).toBe(1);
    expect(h.run('cmd_pr_state --session a --project b').code).toBe(1);
    expect(h.run('cmd_pr_state --session "a b"').stderr).toMatch(/bad session/);
    expect(h.run('cmd_pr_state --project "a b"').stderr).toMatch(/bad project/);
  });

  it('refuses an id it does not hold, and a main checkout that has no branch', () => {
    // Both die BEFORE the gh call: a mistyped id must not spend the repo's one
    // call per sweep, and a main checkout has nothing to bind a PR to.
    h.makeGhRepo('demo');
    h.sh(`_reg_set claude-demo uuid u; _reg_set claude-demo wrapper claude
          _reg_set claude-demo workdir "${path.join(h.home, 'projects', 'demo')}"; _reg_set claude-demo project demo`);
    expect(h.run('cmd_pr_state --session nope').stderr).toMatch(/no such session/);
    expect(h.run('cmd_pr_state --session claude-demo').stderr).toMatch(/not a workspace/);
    expect(h.ghPoison()).toEqual([]);
  });

  it('names pr-state in the usage line a mistyped verb prints', () => {
    // The usage line is the only thing a mistyped verb prints, and it is not
    // covered by the caps parity test — that one compares the caps list with
    // the dispatcher and never reads this string.
    //
    // Under the harness HOME like everything else, even though this only reads:
    // ccd runs `mkdir -p "$REG"` at load, so an unisolated run writes into the
    // real ~/.cc-sessions. HOME is the boundary for RUNNING ccd, not only for
    // the verbs that change something.
    let stderr = '';
    try {
      execFileSync('bash', [CCD, 'no-such-verb'],
        { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }) });
      throw new Error('a verb ccd does not have must exit non-zero');
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? '');
    }
    expect(stderr).toContain('usage: ccd {');
    expect(stderr).toContain('pr-state');
  });

  it('asks gh for --state all and every field the predicate reads', () => {
    // --state closed is a SUPERSET that includes MERGED, so anything but
    // `all` conflates merged with abandoned in both directions. Omitting
    // isCrossRepository hands the badge to any stranger who forks the repo.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    const call = h.ghCalls().find((c) => c.startsWith('pr list'))!;
    expect(call).toContain('--state all');
    expect(call).toContain('--limit 100');
    for (const f of ['headRefOid', 'isCrossRepository', 'baseRefName', 'mergeCommit', 'mergedAt', 'statusCheckRollup']) {
      expect(call).toContain(f);
    }
    expect(call).not.toContain('mergeStateStatus');   // literal "UNKNOWN" on merged PRs
    expect(call).not.toContain('mergeable');
    // The whole list, in order. The loop above says WHY six of these are here;
    // this says that none of the twelve may quietly leave, which the loop
    // cannot: the stub returns its rows whatever --json asks for, and `state`
    // is a substring of `--state all`, so five field names were assertable
    // only as an exact string. Task 12's prstate.ts reads every one of them.
    expect(call).toContain('--json number,state,headRefName,headRefOid,baseRefName,'
      + 'isCrossRepository,mergedAt,mergeCommit,url,title,isDraft,statusCheckRollup');
    // …and the call is WRAPPED. `gh pr list` has no timeout of its own, so a
    // blocking DNS hang is bounded by this and nothing else; without the stub
    // logging its own argv, dropping the wrapper left the suite green.
    expect(h.ghCalls().some((c) => c.startsWith('timeout 12 gh pr list'))).toBe(true);
  });
});

describe('_gh_repo_slug', () => {
  // Four url forms reach `remote.origin.url` in practice and all four have to
  // answer OWNER/NAME, because everything downstream — `--repo`, pr-open's
  // assertion, reap's Phase C — is keyed on it. A form that fell through would
  // answer `no-remote` for a repo that has one.
  it.each([
    ['https://github.com/o/r', 'o/r'],
    ['https://github.com/o/r.git', 'o/r'],
    ['git@github.com:o/r.git', 'o/r'],
    ['ssh://git@github.com/o/r.git', 'o/r'],
  ])('reads %s as %s', (url, slug) => {
    const main = h.makeRepo('demo');
    h.git(main, 'config', 'remote.origin.url', url);
    expect(h.sh(`_gh_repo_slug "${main}"`)).toBe(slug);
  });

  it.each([
    ['https://gitlab.com/o/r'],                  // a host we do not speak for
    ['https://github.com/o/r/tree/main'],        // not a repo root
    ['../origins/demo.git'],                     // a path, which is what makeRepo sets
  ])('refuses %s rather than inventing a slug', (url) => {
    const main = h.makeRepo('demo');
    h.git(main, 'config', 'remote.origin.url', url);
    expect(() => h.sh(`_gh_repo_slug "${main}"`)).toThrow();
  });
});

describe('binding', () => {
  it('reports merged when every conjunct holds', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('merged');
    expect(o.number).toBe(42);
    expect(o.rows[0].ours).toBe(true);
  });

  it('refuses to bind a FORK PR that claims our branch name', () => {
    // gh pr list --head matches headRefName across fork owners (verified
    // against cli/cli: ten unrelated accounts on `patch-1`). This conjunct is
    // the difference between a badge and handing a stranger the archive trigger.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, isCrossRepository: true })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
  });

  it('refuses a PR whose head commit is not in this repository at all', () => {
    // The recycled-slug case: the 144-slug namespace is reused after a reap,
    // and a 100-PR window keeps an old merged PR matchable for months.
    // The second row is what a gh field that is not a string looks like — a
    // sweep that crashed on it would mark every sibling of the repo unknown.
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([
      mergedRow({ headRefOid: '0000000000000000000000000000000000000000' }),
      mergedRow({ number: 43, headRefOid: null }),
    ]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.rows[0].ours).toBe(false);
    expect(o.rows[1].ours).toBe(false);
  });

  it('refuses a PR whose head commit IS here but is not reachable from our tip', () => {
    // The sharper half of the same case, and the only one that exercises the
    // ancestry proof: after a reap recycles `quiet-basin`, the old PR's head
    // commit is still in the shared object store — `cat-file -e` finds it —
    // and it is still merged into main. Only `merge-base --is-ancestor`
    // separates it from the new workspace's own work, so with the zeros
    // fixture alone that call could return a constant and stay green.
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.git(main, 'checkout', '-q', '-b', 'someone-else');
    fs.writeFileSync(path.join(main, 'other.txt'), 'theirs\n');
    h.git(main, 'add', 'other.txt');
    h.git(main, 'commit', '-m', 'someone else');
    const stranger = h.git(main, 'rev-parse', 'HEAD');
    expect(stranger).not.toBe(tip);
    h.ghRows([mergedRow({ headRefOid: stranger })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.rows[0].ours).toBe(false);
    expect(o.phase).toBe('none');
    expect(o.number).toBeNull();
  });

  it.each([
    ['a branch name', 'main'],
    ['a SHORT hex-looking ref, which is why the regex floor is 7', 'abc'],
  ])('never lets gh hand it %s to resolve as a revision', (_what, ref) => {
    // `headRefOid` is a GitHub-sourced string and `is_ours` concatenates it into
    // `<oid>^{commit}` for `cat-file -e` and hands it to `merge-base`. §7 is that
    // no GitHub-sourced string is ever placed in an argv, and the OID regex is
    // what enforces it here — without it gh can name ANY revision this
    // repository can resolve, and a row saying `headRefOid: "main"` would bind
    // and report merged, because main really is an ancestor of our tip. The
    // second row is why the floor is 7 and not 1: `abc` is hex, resolvable, and
    // three characters long.
    const { main, tip } = workspaceWithCommit('demo', 'quiet-basin');
    // `main` is already there and already an ancestor of our tip; `abc` is made.
    if (ref !== 'main') h.git(main, 'branch', ref, tip);
    expect(h.git(main, 'rev-parse', '--verify', ref)).toMatch(/^[0-9a-f]{40}$/);
    h.ghRows([mergedRow({ headRefOid: ref })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.rows[0].ours).toBe(false);
    expect(o.phase).toBe('none');
  });

  it('refuses a PR on a different branch, however well the rest matches', () => {
    // There is no --head filter on the call: it lists the repo's last 100 PRs
    // and this is what selects ours out of them.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, headRefName: 'ws/still-cove' })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('none');
  });

  it('refuses a PR merged into a different base than the one we recorded', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, baseRefName: 'release/9' })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('none');
  });

  it('takes the highest number AFTER binding, never before', () => {
    // Three rows, and both halves of the sentence are load-bearing: the fork's
    // 99 is the highest of all and must lose, and of the two that DO bind the
    // later one must win — a reopened workspace can carry more than one.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([
      mergedRow({ number: 99, headRefOid: tip, isCrossRepository: true }),   // a fork's, higher
      mergedRow({ number: 42, headRefOid: tip }),                            // ours
      mergedRow({ number: 7, headRefOid: tip }),                             // ours, older
    ]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).number).toBe(42);
  });

  it.each([
    ['no merge commit', { mergeCommit: null }],
    ['no mergedAt timestamp', { mergedAt: null }],
    ['a merge commit oid that is not an oid', { mergeCommit: { oid: 'the-branch' } }],
  ])('never claims merged on a partial match — gh MERGED with %s is unknown', (_what, over) => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, ...(over as Record<string, unknown>) })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('unknown');
    // `merge-unproven`, not `error`: the gh read succeeded. This is the token
    // Task 12's agreement test pins prstate.ts's phaseFor equal to.
    expect(o.reason).toBe('merge-unproven');
    expect(o.number).toBe(42);   // the PR is still identified — only the merge is not proven
  });
});

describe('phases without a PR', () => {
  it('is no-commits when the branch has nothing past base', () => {
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('no-commits');
    expect(o.ahead).toBe(0);
  });

  it('is none — ready to compose — when there are commits and no PR', () => {
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.ahead).toBe(1);
    expect(o.commits).toHaveLength(1);
    expect(o.commits[0].subject).toBe('the work');
  });

  it('reports open, draft and closed distinctly', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    const open = { headRefOid: tip, state: 'OPEN', mergedAt: null, mergeCommit: null };
    h.ghRows([mergedRow({ ...open, isDraft: true })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('draft');
    h.ghRows([mergedRow(open)]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('open');
    h.ghRows([mergedRow({ headRefOid: tip, state: 'CLOSED', mergedAt: null, mergeCommit: null })]);
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('closed');
  });

  it('trusts gh\'s state word over the merge fields beside it', () => {
    // A CLOSED row carrying merge fields is a row that contradicts itself.
    // `state` decides, and the safe answer is the one that does not fire the
    // archive trigger: whatever else is on the row, this PR is not merged.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, state: 'CLOSED' })]);   // mergedAt + mergeCommit intact
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).phase).toBe('closed');
  });
});

describe('a branch the registry names that no longer resolves', () => {
  // `git branch -m` inside the worktree. Deviation 7 measured this exact state
  // for `ws-archive` and calls it ORDINARY — it is what a user comparing two
  // names, or renaming outside ccd, leaves behind — and changed the manifest to
  // RECORD it (`tip: null`) rather than refuse. The same fact must not make
  // pr-state destroy a merge.
  const renameAway = (): { tip: string } => {
    const r = workspaceWithCommit('demo', 'quiet-basin');
    h.git(r.wt, 'branch', '-m', 'ws/renamed');
    return r;
  };

  it('keeps a bound MERGED answer, and every persisted field with it', () => {
    // The local tip is a LOCAL fact. It cannot demote gh's answer about a PR
    // that binds on the other three conjuncts: the phase ladder consults the
    // bound row first, and `no-commits` — a positive claim that this branch has
    // nothing past base — is the one thing an unresolvable ref may never
    // manufacture. Shipped behaviour was {phase:"no-commits", tip:""} with
    // prnumber REMOVED, which makes Task 14's auto-archive (prPhase==='merged')
    // unable to ever fire for this workspace and leaves `cmd_ws_archive` with no
    // number to file as `archivedreason merged:#42`.
    const { tip } = renameAway();
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('merged');
    expect(o.number).toBe(42);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
  });

  it('says tip null and ahead null rather than "" and 0', () => {
    // Deviation 7's precedent, verbatim: `tip` is JSON null when the ref does
    // not resolve, never "" and never a substitute oid. `""` and `0` are
    // MEASUREMENTS — "this ref is empty", "this branch is level with base" — and
    // neither was measured here.
    const { tip } = renameAway();
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.tip).toBeNull();
    expect(o.ahead).toBeNull();
  });

  it('is none, never no-commits, when nothing binds either', () => {
    renameAway();
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.ahead).toBeNull();
  });

  it('keeps rc 1 and rc 128 apart — an unreadable repo is not an absent ref', () => {
    // `--quiet` is what makes the distinction exist at all: without it git
    // answers 128 for BOTH, so "that ref does not exist" and "I cannot read that
    // repository" collapse into one empty string. Measured on git 2.43, and it
    // is the same distinction `_ws_archive_manifest` was written to preserve one
    // task earlier in this file. An unreadable $main is not a fact about a PR:
    // it is a per-session failure that persists nothing.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    const out = h.sh(`${GH_STUB} _pr_state_one demo-quiet-basin /no/such/main o/r '[]'`);
    expect(JSON.parse(out)).toEqual({ id: 'demo-quiet-basin', phase: 'unknown', reason: 'error' });
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
  });
});

describe('the object the server reads', () => {
  it('carries exactly the documented keys, and the local facts in them', () => {
    // Every consumer downstream (prstate.ts, the composer, ws-audit) reads
    // this shape. Keys nothing asserts are keys that can silently leave.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(Object.keys(o).sort()).toEqual([
      'ahead', 'base', 'baseShort', 'checkedAt', 'commits', 'dirty', 'id', 'number',
      'phase', 'project', 'repo', 'reason', 'rows', 'template', 'tip', 'branch',
    ].sort());
    expect(o.id).toBe('demo-quiet-basin');
    expect(o.project).toBe('demo');
    expect(o.repo).toBe('o/r');
    expect(o.branch).toBe('ws/quiet-basin');
    expect(o.base).toBe('origin/main');
    expect(o.baseShort).toBe('main');            // what baseRefName is compared against
    expect(o.tip).toMatch(/^[0-9a-f]{40}$/);
    expect(o.checkedAt).toBeGreaterThan(1_700_000_000_000);   // ms, and the same value it persists
    expect(o.checkedAt).toBe(Number(h.reg('demo-quiet-basin', 'prcheckedat')));
    expect(o.template).toBeNull();
    expect(o.dirty).toBe(0);
    // …and `dirty` is a COUNT of the worktree's own lines, not a flag.
    fs.writeFileSync(path.join(wt, 'scratch.txt'), 'x\n');
    fs.writeFileSync(path.join(wt, 'scratch2.txt'), 'x\n');
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).dirty).toBe(2);
  });

  it('carries each commit\'s sha, subject AND body — all three are read downstream', () => {
    // `body` was the one wire key nothing could fail: with `'body': ''`
    // hardcoded the whole suite stayed green at 561. Task 12's `draftPr` reads
    // `real[0].body.trim().split('\n\n')[0]` for the PR body whenever the repo
    // has no template, so every PR ccrc opens could have shipped with an empty
    // one and no test would have said so. Two paragraphs, because the split is
    // on the blank line and a one-paragraph fixture cannot see it.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    fs.writeFileSync(path.join(wt, 'g.txt'), 'more\n');
    h.git(wt, 'add', 'g.txt');
    h.git(wt, 'commit', '-m', 'the second\n\nwhy it was done\n\nand a second paragraph');
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    // Newest first — `git log base..branch` — which is why draftPr reverses.
    expect(o.commits.map((c: { subject: string }) => c.subject)).toEqual(['the second', 'the work']);
    expect(o.commits[0].body).toBe('why it was done\n\nand a second paragraph');
    expect(o.commits[1].body).toBe('');
    expect(o.commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('carries the repo\'s PR template when it has one', () => {
    // Task 4's composer prefills from this; read from $main, not the worktree,
    // so a workspace that has not merged the template still gets it.
    const { main } = workspaceWithCommit('demo', 'quiet-basin');
    fs.mkdirSync(path.join(main, '.github'), { recursive: true });
    fs.writeFileSync(path.join(main, '.github', 'pull_request_template.md'), '## Why\n\n## Risk\n');
    h.ghRows([]);
    // Interior newlines survive; the trailing one does not — `tmpl=$(cat …)`
    // is a command substitution and those strip trailing newlines. Recorded
    // because Task 4's composer prefills a body from this string.
    expect(line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`)).template)
      .toBe('## Why\n\n## Risk');
  });

  it('falls back to origin/HEAD when the registry lost its base', () => {
    // Without the fallback `$base` is empty, the ahead count never runs and a
    // workspace with commits reports `no-commits` — the phase that tells the
    // PWA there is nothing to open a PR for.
    workspaceWithCommit('demo', 'quiet-basin');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.base'));
    h.ghRows([]);
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.base).toBe('origin/HEAD');
    expect(o.ahead).toBe(1);
    expect(o.phase).toBe('none');
  });
});

describe('dirty is a measurement of OUR tree, or it is null', () => {
  // The one class of read in this verb that must be `-C "$workdir"` — it is a
  // question about that directory's CONTENTS — so it runs only after
  // `_ws_wt_branch` and `_ws_common_dir` have both said `$main`, which is the
  // pair Global Constraints prescribe and `cmd_ws_rm` requires before it touches
  // anything. And it never counts a failure as zero: `0` is the positive claim
  // "nothing here is uncommitted".
  it('is null, not 0, when the worktree directory is gone', () => {
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    fs.rmSync(wt, { recursive: true, force: true });
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin 2>"$HOME/pr-err"`);
    expect(line(out).dirty).toBeNull();
    // A NOTE, not a refusal: pr-state is read-only and answers for every
    // workspace of the project from one gh call, so one unreadable worktree must
    // not cost the rest of them their PR state. Everything else is still here.
    expect(fs.readFileSync(path.join(h.home, 'pr-err'), 'utf8')).toContain('demo-quiet-basin');
    expect(line(out).phase).toBe('none');
    expect(line(out).repo).toBe('o/r');
  });

  it('never counts a STRANGER repository squatting the workdir as our dirt', () => {
    // The record outlives the directory, so a hand-deletion plus a `git init` at
    // the same path still answers `$branch` from `$main`'s worktree list — which
    // is why the branch rung alone cannot decide the DIRECTORY. Without the
    // common-dir rung this counts the stranger's untracked files and files them
    // under this workspace.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.sh(`cd "${wt}" && git init -q -b ws/quiet-basin .`);
    fs.writeFileSync(path.join(wt, 'theirs1.txt'), 'x\n');
    fs.writeFileSync(path.join(wt, 'theirs2.txt'), 'x\n');
    h.ghRows([]);
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(line(r.stdout).dirty).toBeNull();
    expect(line(r.stdout).dirty).not.toBe(2);
  });

  it('is null when the tree is entitled but cannot be READ', () => {
    // The rung the shipped one-liner had no way to reach: the pipe threw git's
    // status away, so `status --porcelain` failing read as an empty, clean tree.
    // An unreadable index is a genuine instance — `--git-common-dir` still
    // answers, so the corroboration passes and only the tree read fails.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    const idx = path.join(h.home, 'projects', 'demo', '.git', 'worktrees', 'quiet-basin', 'index');
    expect(fs.existsSync(idx)).toBe(true);
    fs.chmodSync(idx, 0o000);
    try {
      expect(() => h.git(wt, 'status', '--porcelain')).toThrow();      // git really cannot read it
      expect(h.sh(`_ws_common_dir "${wt}"`)).toBe(h.sh(`_ws_common_dir "${path.join(h.home, 'projects', 'demo')}"`));
      h.ghRows([]);
      // Redirected to a file, not read from run().stderr: the harness's run()
      // returns stderr '' for any rc-0 command (execFileSync only surfaces
      // stderr on a throw) — same convention as the unentitled test above.
      const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin 2>"$HOME/pr-err"`);
      expect(line(out).dirty).toBeNull();
      // Deviation 11's contract is "null PLUS one line on stderr" — without this
      // assertion the else-arm is deletable with the suite green, and an
      // operator's unreadable index reports dirty:null with nothing naming
      // which workspace or why (re-review N1).
      const err = fs.readFileSync(path.join(h.home, 'pr-err'), 'utf8');
      expect(err).toContain('could not read the tree');
      expect(err).toContain('demo-quiet-basin');
    } finally {
      fs.chmodSync(idx, 0o644);
    }
  });

  it('is null when the tree could only be PARTIALLY read — rc 0 is not an answer', () => {
    // Final-round verification P2, the reporting half of the same class the
    // destructive verbs carry. The test above reaches the exit-code rung (an
    // unreadable index makes git exit non-zero); this reaches the one it cannot
    // see. Measured on git 2.43: `chmod 000` on a TRACKED directory holding a
    // MODIFIED file gives rc 0, EMPTY stdout, and the diagnostic on stderr — so
    // `grep -c .` counted nothing and the wire carried `"dirty":0`, an
    // affirmative "nothing is uncommitted here" about a file nobody looked at.
    // `dirty` already had an honest unmeasured value; this branch just never
    // used it.
    const { wt } = workspaceWithCommit('demo', 'quiet-basin');
    const tracked = path.join(wt, 'tracked');
    fs.mkdirSync(path.join(tracked, 'deep'), { recursive: true });
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'committed\n');
    h.git(wt, 'add', '-A');
    h.git(wt, 'commit', '-m', 'the work');
    fs.writeFileSync(path.join(tracked, 'deep', 'code.txt'), 'UNCOMMITTED\n');
    fs.chmodSync(tracked, 0o000);
    try {
      // The premise, measured in the fixture: rc 0 and empty stdout, which is
      // what makes this a DIFFERENT rung from the unreadable-index test.
      const probe = h.sh(`git -C "${wt}" status --porcelain 2>"$HOME/probe-err"; echo "rc=$?"; `
        + `echo "out=[$(git -C "${wt}" status --porcelain 2>/dev/null)]"; `
        + `echo "err=[$(cat "$HOME/probe-err")]"`);
      expect(probe, probe).toContain('rc=0');
      expect(probe, probe).toContain('out=[]');
      expect(probe, probe).toContain('Permission denied');

      h.ghRows([]);
      const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin 2>"$HOME/pr-err"`);
      expect(line(out).dirty, 'a partial read is UNMEASURED, never a clean 0').toBeNull();
      const err = fs.readFileSync(path.join(h.home, 'pr-err'), 'utf8');
      expect(err).toContain('could not read the tree');
      expect(err).toContain('demo-quiet-basin');
    } finally {
      fs.chmodSync(tracked, 0o755);
    }
  });
});

describe('failure is an ANSWER, not an error', () => {
  it.each([
    [124, '', 'timeout'],
    [1, 'gh: To get started with GitHub CLI, please run: gh auth login', 'unauthenticated'],
    [1, 'HTTP 403: API rate limit exceeded', 'rate-limit'],
    [1, 'dial tcp: lookup api.github.com: no such host', 'offline'],
    [1, 'something else entirely', 'error'],
  ])('rc %i maps to reason %s on stdout with exit 0', (rc, stderr, reason) => {
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghFail(rc as number, stderr as string);
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ phase: 'unknown', reason });
  });

  it('leaves the persisted prphase untouched when the read failed', () => {
    // A failed read must never overwrite the last good answer — that is what
    // makes "last checked 6m ago" honest rather than a fresh-looking lie.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    h.ghFail(124, '');
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    // …and the number with it. The clearing rule below must never be reachable
    // from a failed read: `_gh_pr_list` returns before `_pr_py` is called, and
    // this is what says so.
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
  });

  it.each([
    ['a body that is not JSON at all', 'MALFORMED-AFTER-GOOD'],
    ['a JSON object where a list was promised', '{"pr":"list"}'],
    ['nothing at all on stdout', ''],
  ])('an rc-0 gh answer with %s is unknown/error and writes NOTHING', (_what, body) => {
    // `gh` exiting 0 is not the same as `gh` having ANSWERED. A body that does
    // not parse as a list of rows is a read we could not understand, and the
    // one thing it must never become is `[]` — the empty list is the affirmative
    // answer "this repo has no PR for you", which clears the persisted merge and
    // then reads on the phone as "ready to open a pull request".
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    const before = h.reg('demo-quiet-basin', 'prcheckedat');

    h.ghRaw(body as string);
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ phase: 'unknown', reason: 'error' });
    // Every one of the three persisted fields is untouched — including
    // `prcheckedat`, because a reading nobody could parse is not a reading.
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(h.reg('demo-quiet-basin', 'prcheckedat')).toBe(before);
  });

  it('answers no-remote when the project has no origin', () => {
    const main = path.join(h.home, 'projects', 'bare');
    fs.mkdirSync(main, { recursive: true });
    h.sh(`cd "${main}" && git init -q -b main .`);
    h.sh(`_reg_set bare-x uuid u; _reg_set bare-x wrapper claude; _reg_set bare-x workdir "${main}"
          _reg_set bare-x project bare; _reg_set bare-x workspace x; _reg_set bare-x branch ws/x`);
    expect(JSON.parse(h.sh(`${GH_STUB} cmd_pr_state --session bare-x`)))
      .toEqual({ phase: 'unknown', reason: 'no-remote' });
  });
});

describe('--project', () => {
  it('emits one JSON line per workspace of that project from ONE gh call', () => {
    // 8 projects x 1 call / 120 s is ~5% of the GraphQL budget. Per session
    // it would be several times that for no extra information.
    h.makeGhRepo('demo');
    h.makeGhRepo('other', 'o/other');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=amber-ridge cmd_ws_add other`);   // a different repo's
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out).toHaveLength(2);
    expect(out.map((l) => JSON.parse(l).id).sort()).toEqual(['demo-quiet-basin', 'demo-still-cove']);
    expect(h.ghCalls().filter((c) => c.startsWith('pr list'))).toHaveLength(1);
    // One repo per call, and it is THIS repo: a second project's workspaces are
    // neither listed nor asked about.
    expect(h.ghCalls().find((c) => c.startsWith('pr list'))).toContain('--repo o/r');
  });

  it('says nothing, at exit 0, about a project with no workspaces', () => {
    // The unexpanded-glob path: with an empty registry `"$REG"/*.workspace`
    // stays literal, and a sweep lane calling this every 120 s must get silence
    // rather than a line about a file named `*.workspace`.
    const r = h.run('cmd_pr_state --project demo');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(h.ghPoison()).toEqual([]);            // and it never reached gh at all
  });

  it('skips a half-written registry entry rather than reporting it', () => {
    // `.workspace` lands before `.uuid` does. A row for a session that does not
    // exist yet would appear in the fleet and then vanish.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh('_reg_set demo-half workspace half; _reg_set demo-half project demo');
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out.map((l) => JSON.parse(l).id)).toEqual(['demo-quiet-basin']);
  });

  it('ignores main checkouts of that project — they have no branch to bind', () => {
    h.makeGhRepo('demo');
    h.sh(`_reg_set claude-demo uuid u; _reg_set claude-demo wrapper claude
          _reg_set claude-demo workdir "${path.join(h.home, 'projects', 'demo')}"; _reg_set claude-demo project demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out).toHaveLength(1);
  });

  it('applies the id regex to what it read off the directory, not only to argv', () => {
    // `--session` validates its argv and `--project` validates its own, but the
    // ids on THIS path come from a directory listing and had every `$REG/$id.*`
    // path built from them unchecked. The plan's rule is "before any path is
    // built from an id", with no exception for ids ccd wrote itself: a
    // filename cannot hold a `/`, so nothing traversable is reachable and every
    // read here is read-only — this is the rule, applied where it was skipped.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    const reg = path.join(h.home, '.cc-sessions');
    for (const f of ['workspace', 'uuid', 'project']) {
      fs.writeFileSync(path.join(reg, `de mo.${f}`), f === 'project' ? 'demo' : 'x');
    }
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out.map((l) => JSON.parse(l).id)).toEqual(['demo-quiet-basin']);
  });

  it('refuses a registry project it cannot build a path from', () => {
    // `--session` validates the id it was handed; `$main` is then built from a
    // registry VALUE that nothing checked. Same class as the id, same regex,
    // and it `die`s rather than answering, because that is what this verb
    // already does for every other registry-identity error (`no such session`,
    // `not a workspace`).
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    fs.writeFileSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.project'), '../../etc');
    const r = h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad project/);
    expect(h.ghPoison()).toEqual([]);            // and it died before any gh call
  });

  it('names the SESSION in a per-session failure, so it cannot poison its siblings', () => {
    // A workspace whose registry lost its `branch` is one broken session, not
    // a broken repo. The server backs a whole PROJECT off on the id-LESS
    // failure shape, so if this object omitted the id, one incomplete registry
    // entry would mark every sibling `unknown` and silence the project's sweep
    // lane — §6's "Partial sweep" row promises the opposite.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.sh(`${WS_ADD} CCD_WS_SLUG=still-cove cmd_ws_add demo`);
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-still-cove.branch'));
    h.ghRows([]);
    const out = h.sh(`${GH_STUB} cmd_pr_state --project demo`).split('\n').filter(Boolean);
    expect(out).toHaveLength(2);
    const byId = Object.fromEntries(out.map((l) => [JSON.parse(l).id, JSON.parse(l)]));
    expect(byId['demo-still-cove']).toEqual({ id: 'demo-still-cove', phase: 'unknown', reason: 'error' });
    expect(byId['demo-quiet-basin'].phase).toBe('no-commits');   // its sibling is untouched
  });
});

describe('persistence', () => {
  it('writes prphase, prnumber and prcheckedat into the registry', () => {
    // The server cannot write the registry (the agent's write whitelist is
    // .cc-clips only), so the box that reads GitHub is the box that persists.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    expect(Number(h.reg('demo-quiet-basin', 'prcheckedat'))).toBeGreaterThan(1_700_000_000_000);
  });

  it('CLEARS prnumber when the answer no longer carries one', () => {
    // phase and number are one answer, so a writer that updates half of it
    // lies. A PR that is deleted, force-pushed out of reachability, or whose
    // slug has been recycled leaves {phase:'none', number:42} on disk, and
    // fleet.ts hands that pair straight to the wire — the cap renders `#42`
    // under a phase whose own copy is "no pull request yet". ws-archive reads
    // the same field and would file `archivedreason merged:#42` for a PR that
    // no longer binds to this workspace.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');
    h.ghRows([]);                                  // the PR is gone
    const o = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(o.phase).toBe('none');
    expect(o.number).toBeNull();
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBeNull();
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('none');
  });

  it('never advances prphase past a prnumber write that did not happen', () => {
    // Final-round integration New Finding 9. `prphase` and `prnumber` are two
    // FILES, so no ordering makes the pair atomic — but the order decides which
    // half-written pairs a kill can leave behind, and the shipped one
    // (`put('prphase')` nineteen lines ahead of the number) left exactly
    // {'none', 42}: the pair docket 1 proved otherwise unconstructible, the one
    // fleet.ts renders as `#42` under "no pull request yet", and the one
    // ws-archive files as `merged:#42`. `clear('prnumber')` now runs FIRST, so
    // the intermediates are {old phase, absent} and {new phase, absent} — a
    // degraded reading, never a false one.
    //
    // The interruption is injected where the test can see it: a DIRECTORY at
    // the `prnumber` path makes `os.remove` raise `IsADirectoryError`, which
    // `clear`'s `except FileNotFoundError` does not catch, so the write of the
    // pair aborts at exactly the step the ordering is about. What is asserted
    // is the ordering property itself — the phase must not have moved.
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase')).toBe('merged');
    expect(h.reg('demo-quiet-basin', 'prnumber')).toBe('42');

    const numberPath = path.join(h.home, '.cc-sessions', 'demo-quiet-basin.prnumber');
    fs.rmSync(numberPath);
    fs.mkdirSync(numberPath);
    h.ghRows([]);                                  // the new answer is {none, no number}
    h.run(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.reg('demo-quiet-basin', 'prphase'),
      'the phase moved to a value whose number never landed').toBe('merged');
    expect(fs.statSync(numberPath).isDirectory(), 'the fixture must survive the run').toBe(true);
  });
});

describe('gh isolation', () => {
  // Both halves of the boundary, because only one of them is a shell function
  // and functions are only shadowing what is on PATH while someone remembers to
  // include them.
  it('reaches the STUB, never the poisoned gh, when the stub is included', () => {
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(h.ghCalls().some((c) => c.startsWith('pr list'))).toBe(true);
    expect(h.ghPoison()).toEqual([]);              // the function won, as bash promises
  });

  it('cannot reach the host gh even when a snippet forgets the stub', () => {
    // /usr/bin/gh is installed here and ~/.config/gh/hosts.yml holds a real
    // token with repo WRITE scope. Without the harness's poisoned gh first on
    // PATH this snippet is a live call to the real github.com/o/r, and every
    // future PR test is one forgotten `${GH_STUB}` away from being one too.
    // What ccd sees is a gh that fails, which is an ANSWER — reason `error`.
    workspaceWithCommit('demo', 'quiet-basin');
    const r = h.run('cmd_pr_state --session demo-quiet-basin');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ phase: 'unknown', reason: 'error' });
    expect(h.ghPoison()).toHaveLength(1);
    expect(h.ghPoison()[0]).toContain('pr list');
    expect(h.ghCalls()).toEqual([]);
  });
});

describe('ccd and prstate.ts agree about phase, always', () => {
  // The predicate exists twice by necessity: ccd persists it (the server
  // cannot write the registry) and prstate.ts puts it on the wire. Drift means
  // the fleet card and the registry disagree about the same PR, silently.
  // This is the device that stops it, and it is the same precedent as
  // _ws_least_loaded vs limits.ts projectHome.
  //
  // EVERY ROW CARRIES ITS EXPECTED PHASE **AND REASON**, and both
  // implementations are asserted against THAT, not against each other.
  // `expect(phaseFor(l).phase).toBe(l.phase)` alone is satisfied by any SHARED
  // misreading — including both sides answering `unknown` because the fixture's
  // origin was unresolvable, which is exactly how this test would have passed
  // while proving nothing. The third and fourth elements are the anchor; if a
  // row's expectation is wrong, one of the four assertions fails and says which
  // side.
  //
  // `reason` is pinned because phase agreement alone let the two drift on it:
  // ccd wrote no reason for the merged-but-unproven row while phaseFor answered
  // `error`, i.e. "GitHub could not be read" about a read that worked.
  type Reason = string | null;
  const matrix: [string, Record<string, unknown>, string, Reason][] = [
    ['merged',          {}, 'merged', null],
    // A fork PR does not bind, and with commits past base an unbound workspace
    // is `none` — ready to compose — never `no-commits`.
    ['fork',            { isCrossRepository: true }, 'none', null],
    ['other base',      { baseRefName: 'release/9' }, 'none', null],
    // THE TWO CONJUNCTS THE MATRIX USED TO HOLD CONSTANT — final-round
    // integration New Finding 8. `bound()` (ccd) and `boundRow()`
    // (prstate.ts:113) are each four conjuncts, and every row above varies one
    // of only two of them: `isCrossRepository` and `baseRefName`. Both
    // `headRefName === branch` and `ours === true` were the same on all seven
    // rows, so DELETING either conjunct from either implementation left all
    // nine agreement cases green — the exact drift this device exists to catch.
    // Measured: with `&& row.headRefName === registryBranch` removed from
    // prstate.ts, the matrix passed.
    //
    // The head-NAME rung: same head commit, same base, same repository, a
    // different branch name. `gh pr list --head` matches the name across fork
    // owners (prstate.ts:102), which is why the name is a conjunct and not a
    // shorthand for the others.
    ['other head name', { headRefName: 'ws/still-cove' }, 'none', null],
    // The `ours` rung, i.e. proof 0: a well-formed head oid this repository
    // has never seen. `is_ours`'s `cat-file -e` rung answers False, ccd
    // annotates `ours: false`, and both sides must then refuse to bind — this
    // is the row a recycled slug and a stranger's fork both produce.
    ['head commit we do not have', { headRefOid: 'b'.repeat(40) }, 'none', null],
    // Binds, but the merge predicate fails a conjunct while gh still says
    // MERGED: `unknown`, never `merged`. The archive trigger hangs off this.
    // The reason is `merge-unproven` and NOT any read-failure token — the gh
    // call succeeded, and this row is the only one in the matrix with a reason.
    ['no merge commit', { mergeCommit: null }, 'unknown', 'merge-unproven'],
    ['open',            { state: 'OPEN', mergedAt: null, mergeCommit: null }, 'open', null],
    ['draft',           { state: 'OPEN', mergedAt: null, mergeCommit: null, isDraft: true }, 'draft', null],
    ['closed',          { state: 'CLOSED', mergedAt: null, mergeCommit: null }, 'closed', null],
  ];

  it.each(matrix)('%s', async (_name, over, expected, expectedReason) => {
    const { phaseFor } = await import('../src/prstate.js');
    const { tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.ghRows([mergedRow({ headRefOid: tip, ...over })]);
    const l = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    // A read-failure reason here — `no-remote` is the classic — means the read
    // never got as far as the predicate, and both sides would then agree on
    // `unknown` for a reason that has nothing to do with agreement. Pinning the
    // expected reason per row catches that too: `no-remote` matches no row.
    expect(l.reason, 'ccd disagrees with the matrix about reason').toBe(expectedReason);
    expect(l.phase, 'ccd disagrees with the matrix').toBe(expected);
    const s = phaseFor(l as never);
    expect(s.phase, 'prstate.ts disagrees with the matrix').toBe(expected);
    expect(s.reason, 'prstate.ts disagrees with the matrix about reason').toBe(expectedReason);
  });

  it('agrees that ahead === 0 with no PR is no-commits — and that a bound merge still wins', () => {
    // The third variable New Finding 8 names, and the one the matrix above
    // cannot carry: `ahead` is not a field of the gh row, it is a property of
    // the FIXTURE, and every row above is built on `workspaceWithCommit`, so
    // every one of them has `ahead === 1`. ccd chooses between the two with
    // `('no-commits' if ahead == 0 else 'none')` and `phaseFor` with
    // `line.ahead === 0 ? 'no-commits' : 'none'` (prstate.ts:166) — a whole
    // branch of both implementations that no agreement case ever entered.
    h.makeGhRepo('demo');
    h.sh(`${WS_ADD} CCD_WS_SLUG=quiet-basin cmd_ws_add demo`);
    h.ghRows([]);
    const l = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l.ahead, 'the fixture must actually be level with base').toBe(0);
    expect(l.phase, 'ccd').toBe('no-commits');
    const s = phaseFor(l as never);
    expect(s.phase, 'prstate.ts').toBe('no-commits');
    expect(s.reason, 'and neither side invents a reason for it').toBeNull();

    // …and `ahead === 0` never overrides a binding: a level branch whose PR
    // merged is `merged` on both sides. Without this half, an implementation
    // that answered `no-commits` for every ahead-0 line — before consulting
    // `boundRow` at all — would still agree with the first half.
    const tip = h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-basin'), 'rev-parse', 'HEAD');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const l2 = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l2.ahead).toBe(0);
    expect(l2.phase, 'ccd').toBe('merged');
    expect(phaseFor(l2 as never).phase, 'prstate.ts').toBe('merged');
  });

  // TWO MORE ROWS THE MATRIX ABOVE CANNOT EXPRESS, because what varies is not a
  // field of the gh row. Task 3's fix round (findings 1 and 2) created both
  // states, and neither had anything for `phaseFor` to agree about before it.
  it('agrees when the registry\'s branch no longer resolves — a bound merge still wins', () => {
    // `git branch -m` inside the worktree. ccd sends `tip: null` and
    // `ahead: null`, the ancestry rung of proof 0 is skipped (there is no tip to
    // reach from) and the row still binds on its other three conjuncts, so BOTH
    // sides must answer `merged`. The trap this pins is `no-commits`: ccd used
    // to compute it from a fabricated `ahead: 0`, and a `phaseFor` written
    // against `(line.ahead ?? 0) === 0` would reproduce the same lie on the wire.
    const { wt, tip } = workspaceWithCommit('demo', 'quiet-basin');
    h.git(wt, 'branch', '-m', 'ws/renamed');
    h.ghRows([mergedRow({ headRefOid: tip })]);
    const l = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l.tip).toBeNull();
    expect(l.ahead).toBeNull();
    expect(l.phase).toBe('merged');
    expect(phaseFor(l as never).phase).toBe('merged');
    // …and with no PR at all in the same state, `none`, never `no-commits`.
    h.ghRows([]);
    const l2 = line(h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`));
    expect(l2.phase).toBe('none');
    expect(phaseFor(l2 as never).phase).toBe('none');
  });

  it('agrees that an unreadable gh body is a WHOLE-REPO failure, not a line', () => {
    // rc 0 with a body that is not a list of rows. ccd emits the id-less failure
    // object and persists nothing; `parsePrLines` must classify it as
    // `CcdPrFailure` so the sweep backs the project off — reading it as a full
    // line would send it to `phaseFor` with no `rows` and throw inside a
    // void-dispatched sweep.
    workspaceWithCommit('demo', 'quiet-basin');
    h.ghRaw('MALFORMED');
    const out = h.sh(`${GH_STUB} cmd_pr_state --session demo-quiet-basin`);
    expect(parsePrLines(out)).toEqual([{ phase: 'unknown', reason: 'error' }]);
    expect(isFullLine(parsePrLines(out)[0]!)).toBe(false);
  });
});
