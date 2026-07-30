import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, WS_ADD } from './ccdWsHelpers.js';
import { GH_STUB, makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-propen-'); });
afterEach(() => { h.cleanup(); });

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64');

/** `makeGhRepo`: the origin reads as `https://github.com/o/r` (so
 *  `_gh_repo_slug` yields the `o/r` the create assertion below names) while
 *  `remote.origin.pushurl` still points at `$HOME/origins/demo.git`, which is
 *  what makes "the branch really is on the origin now" a real assertion. */
const workspace = (project: string, slug: string): string => {
  h.makeGhRepo(project);
  h.sh(`${WS_ADD} CCD_WS_SLUG=${slug} cmd_ws_add ${project}`);
  const wt = path.join(h.home, 'worktrees', project, slug);
  fs.writeFileSync(path.join(wt, 'f.txt'), 'work\n');
  h.git(wt, 'add', 'f.txt');
  h.git(wt, 'commit', '-m', 'the work');
  return wt;
};

/** Every interpolated value is SINGLE-QUOTED, including the base64. Unquoted,
 *  `b64('')` is the empty string and the shell splits it away entirely: argv
 *  becomes seven tokens, `[[ $# -eq 8 … ]]` fires first, and the "empty body"
 *  test below would pass against the usage line while proving nothing about
 *  the guarantee it names. (Base64's alphabet is `A-Za-z0-9+/=`, so single
 *  quotes are safe around it.) */
const open = (extra = '', id = 'demo-quiet-basin', title = 'the work', body = 'because', draft = 'false') =>
  h.run(`${GH_STUB} ${extra} cmd_pr_open --session '${id}' --title '${title}' --body-b64 '${b64(body)}' --draft '${draft}'`);

describe('argv discipline', () => {
  it('takes exactly four flag/value pairs, in exactly that order', () => {
    workspace('demo', 'quiet-basin');
    expect(h.run(`${GH_STUB} cmd_pr_open --session demo-quiet-basin`).code).toBe(1);
    expect(h.run(`${GH_STUB} cmd_pr_open --title t --session demo-quiet-basin --body-b64 ${b64('b')} --draft false`).code).toBe(1);
    // Extra tokens after the pinned prefix are what a prefix whitelist CANNOT
    // constrain, so fixed arity is the thing that actually stops them.
    expect(h.run(`${GH_STUB} cmd_pr_open --session demo-quiet-basin --title t --body-b64 ${b64('b')} --draft false --repo evil/repo`).code).toBe(1);
  });

  it('has no path-taking flag, no argv passthrough, and no git command in $workdir', () => {
    // gh pr create -F <file> reads any file the uid can, including
    // ~/.config/gh/hosts.yml (0600, two live gho_ tokens). The only correct
    // version of "not exposed in the UI" is "not implemented" — so this reads
    // the shipped script rather than probing behaviour a future edit could add
    // back without failing any behavioural test.
    //
    // `-C "$workdir"` is banned for the same reason and is checked the same
    // way. The push below is the one network write in this design, and a ref
    // resolved inside $workdir is a ref a squatter at that path controls (the
    // squatter test at the bottom of this file witnesses it). The behavioural
    // test can only show that TODAY's push sends $main's ref; this line is what
    // stops the next edit reaching into the directory for anything at all.
    //
    // Comment lines are stripped first: the assertion is about executable
    // text, and the comments in there deliberately SAY "never --force" and name
    // $workdir.
    const src = fs.readFileSync(CCD, 'utf8');
    const start = src.indexOf('cmd_pr_open()');
    const fn = src.slice(start, src.indexOf('\ncmd_', start + 10))
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    for (const banned of ['--body-file', '-F ', '--template', '--fill', '--force', '"$@"',
                          '-C "$workdir"']) {
      expect(fn, `cmd_pr_open must not contain ${banned}`).not.toContain(banned);
    }
  });

  it('rejects a title over 256 chars, an empty title and control characters', () => {
    workspace('demo', 'quiet-basin');
    expect(open('', 'demo-quiet-basin', 'x'.repeat(257)).stderr).toMatch(/title too long/);
    expect(open('', 'demo-quiet-basin', '').stderr).toMatch(/empty title/);
    expect(h.run(`${GH_STUB} cmd_pr_open --session demo-quiet-basin --title "$(printf 'a\\tb')" --body-b64 ${b64('b')} --draft false`).stderr)
      .toMatch(/control characters/);
  });

  it('rejects a body that is not base64, is empty, or exceeds 64 KiB', () => {
    workspace('demo', 'quiet-basin');
    expect(h.run(`${GH_STUB} cmd_pr_open --session demo-quiet-basin --title t --body-b64 '!!!' --draft false`).stderr)
      .toMatch(/bad --body-b64/);
    // An EMPTY --body suppresses the repo's PR template, so ccd always passes
    // a non-empty one. This is that guarantee, asserted.
    expect(open('', 'demo-quiet-basin', 't', '').stderr).toMatch(/empty body/);
    expect(open('', 'demo-quiet-basin', 't', 'x'.repeat(65537)).stderr).toMatch(/body too large/);
  });

  it('rejects a --draft value that is not true or false', () => {
    workspace('demo', 'quiet-basin');
    expect(open('', 'demo-quiet-basin', 't', 'b', 'maybe').stderr).toMatch(/bad --draft/);
  });
});

describe('refusals that protect the remote', () => {
  it('refuses a main checkout — the verb would push to main on its first step', () => {
    // Nine of nine sessions on the live box are main checkouts, several
    // sitting on main with an upstream.
    h.makeGhRepo('demo');
    h.sh(`_reg_set claude-demo uuid u; _reg_set claude-demo wrapper claude
          _reg_set claude-demo workdir "${path.join(h.home, 'projects', 'demo')}"; _reg_set claude-demo project demo`);
    expect(open('', 'claude-demo').stderr).toMatch(/not a workspace/);
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses when head equals base', () => {
    workspace('demo', 'quiet-basin');
    h.sh('_reg_set demo-quiet-basin branch main');
    expect(open().stderr).toMatch(/head equals base/);
  });

  it('refuses an unknown session before touching gh or git', () => {
    expect(open('', 'nope-nothing').stderr).toMatch(/no such session/);
    expect(h.ghCalls()).toEqual([]);
  });
});

describe('the happy path', () => {
  it('checks for an existing PR BEFORE pushing, and returns it unchanged', () => {
    workspace('demo', 'quiet-basin');
    h.ghRows([{ number: 7, url: 'https://github.com/o/r/pull/7', state: 'OPEN' }]);
    const r = open();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)[0].number).toBe(7);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    // Idempotence means idempotence: no push either. Asserted at the ORIGIN,
    // which is the only place a push is observable — the local branch and the
    // worktree's HEAD look identical whether or not one happened.
    expect(() => h.git(path.join(h.home, 'origins', 'demo.git'), 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'))
      .toThrow();
    // ...and the workspace is untouched: still on its own branch.
    expect(h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-basin'), 'rev-parse', '--symbolic-full-name', 'HEAD'))
      .toBe('refs/heads/ws/quiet-basin');
  });

  it('pushes fully-qualified, never with --force, and creates with a fixed flag order', () => {
    workspace('demo', 'quiet-basin');
    h.ghRows([]);
    const r = open();
    expect(r.code).toBe(0);
    const create = h.ghCalls().find((c) => c.startsWith('pr create'))!;
    expect(create).toBe(
      'pr create --repo o/r --head ws/quiet-basin --base main --title the work --body because');
    // The branch really is on the origin now, pushed by refspec from $main —
    // and it is $main's ref, byte for byte. Verified in a throwaway repo before
    // this was written: a linked worktree's commits are in the shared object
    // store, so `git -C "$main" push refs/heads/b:refs/heads/b` sends exactly
    // the work committed in the worktree.
    const origin = path.join(h.home, 'origins', 'demo.git');
    const main = path.join(h.home, 'projects', 'demo');
    expect(h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'))
      .toBe(h.git(main, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'));
    // --set-upstream from $main writes branch.<b>.remote/merge into the COMMON
    // config, so the workspace sees its own upstream — which is what
    // _ws_reap_eval's `no-upstream` refusal later reads (verified: identical
    // config keys and values to the same push run inside the worktree).
    expect(h.git(path.join(h.home, 'worktrees', 'demo', 'quiet-basin'), 'rev-parse', '--abbrev-ref', '@{upstream}'))
      .toBe('origin/ws/quiet-basin');
  });

  it('appends --draft LAST when asked, and never otherwise', () => {
    workspace('demo', 'quiet-basin');
    h.ghRows([]);
    open('', 'demo-quiet-basin', 'the work', 'because', 'true');
    expect(h.ghCalls().find((c) => c.startsWith('pr create'))!.endsWith('--draft')).toBe(true);
  });

  it('aborts before any gh call when the push fails', () => {
    workspace('demo', 'quiet-basin');
    h.ghRows([]);
    // Break the remote: push must fail, and nothing may be opened.
    fs.rmSync(path.join(h.home, 'origins', 'demo.git'), { recursive: true, force: true });
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/push failed/);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
  });
});

/** The push is the one place this design reaches the network, so the two facts
 *  it rests on are tested on their own: that git's record for $workdir names the
 *  registry's branch, and that the ref on the wire comes from $main. */
describe('the ref is $main’s, and the directory only ever corroborates it', () => {
  it('refuses unless $main’s own worktree record names the registry’s branch', () => {
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    const origin = path.join(h.home, 'origins', 'demo.git');
    h.ghRows([]);

    // Rung 1 — drift. $main really has BOTH branches, so nothing else in this
    // verb would stop it: without the corroboration pr-open pushes `ws/other`,
    // a branch no workspace is on, and opens a PR for it.
    h.git(main, 'branch', 'ws/other', 'main');
    h.sh('_reg_set demo-quiet-basin branch ws/other');
    const drift = open();
    expect(drift.code).toBe(1);
    expect(drift.stderr).toMatch(/registry says ws\/other, git's worktree record for .+ says ws\/quiet-basin/);
    h.sh('_reg_set demo-quiet-basin branch ws/quiet-basin');

    // Rung 2 — git RECORDED a detached HEAD (`_ws_wt_branch` answers empty with
    // exit 0), so there is no head branch to open a PR from.
    h.git(wt, 'checkout', '-q', '--detach', 'HEAD');
    expect(open().stderr).toMatch(/on a detached HEAD/);
    h.git(wt, 'checkout', '-q', 'ws/quiet-basin');

    // Rung 3 — no record at all: the admin directory was removed by hand, which
    // leaves the branch and the worktree directory both intact (measured on git
    // 2.43) while nothing ties the two together any more. `_ws_wt_branch` exits
    // 1, and "no evidence" is the reading that writes nothing.
    const admin = path.join(main, '.git', 'worktrees', 'quiet-basin');
    expect(fs.existsSync(admin),
      'git names the admin directory after the worktree basename — if that changed, fix the fixture',
    ).toBe(true);
    fs.rmSync(admin, { recursive: true, force: true });
    expect(open().stderr).toMatch(/no worktree record for/);

    // None of the three reached the network, and none of them pushed.
    expect(h.ghCalls()).toEqual([]);
    expect(() => h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/other')).toThrow();
    expect(() => h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin')).toThrow();
  });

  it('pushes $main’s ref, never the ref of a stranger repository at $workdir', () => {
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    const origin = path.join(h.home, 'origins', 'demo.git');
    const ours = h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin');

    // A stranger repository takes the path: same branch NAME, a different
    // commit, and an `origin` that is the same bare repo — which is what a
    // hand-made clone left at that path looks like, and it is the case that
    // makes the difference visible instead of merely theoretical.
    //
    // The branch corroboration above does NOT catch this and is not supposed
    // to: measured on git 2.43, $main's record still reads healthy with no
    // `prunable` marker (the record's gitdir file now points at the stranger's
    // own .git), so it still says `ws/quiet-basin`. What closes it is WHERE the
    // ref is resolved.
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.git(wt, 'init', '-q', '-b', 'ws/quiet-basin');
    fs.writeFileSync(path.join(wt, 'evil.txt'), 'evil\n');
    h.git(wt, 'add', 'evil.txt');
    h.git(wt, 'commit', '-m', 'stranger work');
    h.git(wt, 'remote', 'add', 'origin', origin);
    const theirs = h.git(wt, 'rev-parse', 'refs/heads/ws/quiet-basin');
    expect(theirs).not.toBe(ours);

    h.ghRows([]);
    expect(open().code).toBe(0);
    // The assertion that witnesses the hole, and it is about the REF: the
    // origin's object store proves nothing (it can hold a stranger's objects
    // for a dozen innocent reasons), while the ref moves only for whoever
    // pushed it. Measured with the push in $workdir: the origin ends up on
    // `theirs`, and `gh pr create --head` then opens, emails and CIs a PR over
    // a stranger's commit.
    expect(h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin')).toBe(ours);
    // ...and both halves of the write name one repository: the slug came from
    // $main's remote.origin.url, the ref from $main's ref store.
    expect(h.ghCalls().find((c) => c.startsWith('pr create'))!).toBe(
      'pr create --repo o/r --head ws/quiet-basin --base main --title the work --body because');
  });
});
