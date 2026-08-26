import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { CCD, WS_ADD, ghContainedEnv } from './ccdWsHelpers.js';
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

/** A `gh` that behaves the way the real one does ACROSS a create: no PR before
 *  `pr create`, the fixture's rows after. `ghRows` is one file read by every
 *  call, so it cannot express "the probe and the read-back answer differently
 *  in one run" — which is the only run in which the create path has an answer
 *  at all. Layered after `GH_STUB` so it wins, and it logs the same argv.
 *
 *  `pr create` PRINTS THE PR URL, because the real one does. A silent create
 *  made `>/dev/null` on that call unfalsifiable: dropping it left the suite
 *  green while, against a real gh, the URL would land in front of the JSON this
 *  verb answers with. */
const GH_CREATES = `
gh() {
  printf '%s\\n' "$*" >> "$HOME/gh-calls"
  case "$1 $2" in
    "pr create") touch "$HOME/gh-created"
                 echo 'https://github.com/o/r/pull/9'; return 0 ;;
  esac
  if [[ -f "$HOME/gh-created" ]]; then cat "$HOME/gh-rows.json"; else echo '[]'; fi
};`;

describe('argv discipline', () => {
  it('takes exactly four flag/value pairs, in exactly that order', () => {
    workspace('demo', 'quiet-basin');
    // An existing PR, so the extra-token call below would SUCCEED on arity
    // `-ge 8` instead of failing for the harness's own reasons: without a rows
    // fixture the fail-closed probe refuses it whatever the arity says, and the
    // assertion would pass while proving nothing.
    h.ghRows([{ number: 7, url: 'u', state: 'OPEN', isDraft: false }]);
    expect(h.run(`${GH_STUB} cmd_pr_open --session demo-quiet-basin`).code).toBe(1);
    expect(h.run(`${GH_STUB} cmd_pr_open --title t --session demo-quiet-basin --body-b64 ${b64('b')} --draft false`).code).toBe(1);
    // Extra tokens after the pinned prefix are what a prefix whitelist CANNOT
    // constrain, so fixed arity is the thing that actually stops them.
    expect(h.run(`${GH_STUB} cmd_pr_open --session demo-quiet-basin --title t --body-b64 ${b64('b')} --draft false --repo evil/repo`).code).toBe(1);
  });

  it('checks each of the four flag names in its OWN position', () => {
    // Four assertions, four fixtures. One wrong-order fixture trips whichever
    // assertion still stands, so three of the four were untested at any moment
    // — each of these is eight tokens, so arity passes and only the position it
    // names can refuse it.
    workspace('demo', 'quiet-basin');
    const b = b64('b');
    for (const argv of [
      `--sess demo-quiet-basin --title t --body-b64 ${b} --draft false`,
      `--session demo-quiet-basin --titel t --body-b64 ${b} --draft false`,
      `--session demo-quiet-basin --title t --body64 ${b} --draft false`,
      `--session demo-quiet-basin --title t --body-b64 ${b} --draf false`,
    ]) {
      const r = h.run(`${GH_STUB} cmd_pr_open ${argv}`);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toMatch(/usage: ccd pr-open/);
    }
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses a session id that is not one, before any path is built from it', () => {
    // Global Constraints name this guard explicitly. Removing it degrades to
    // `no such session`, which is a refusal too — so only a fixture that says
    // WHICH refusal it wants keeps the guard alive.
    workspace('demo', 'quiet-basin');
    const r = h.run(`${GH_STUB} cmd_pr_open --session '../../etc/passwd' --title t --body-b64 ${b64('b')} --draft false`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad session id/);
    expect(h.ghCalls()).toEqual([]);
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
    //
    // BOTH anchors are asserted, and the slice ends at cmd_pr_open's own
    // closing brace. `indexOf` answers -1 for a miss, `slice(-1, …)` is the
    // EMPTY STRING, and a scan of the empty string passes every literal: a
    // behaviour-preserving `cmd_pr_open () {` alone turned this whole ban off,
    // and measured that way `--body-file -F --template --fill --force "$@"`
    // plus a live `git -C "$workdir"` inside the function left all 14 tests
    // green. It is also why the red run printed "1 passed". Ending at the next
    // `\ncmd_` was the second half of the same problem: that is `cmd_ws_gc` 277
    // lines further down, so the ban silently covered every `_ws_gc_*` helper —
    // dilutable, and a false positive waiting for an unrelated task.
    const src = fs.readFileSync(CCD, 'utf8');
    const head = 'cmd_pr_open() {';
    expect(src.split(head).length - 1, 'exactly one cmd_pr_open definition').toBe(1);
    const start = src.indexOf(head);
    const end = src.indexOf('\n}\n', start);
    expect(end, 'cmd_pr_open must close on a column-0 brace').toBeGreaterThan(start);
    const fn = src.slice(start, end)
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    // The window must really reach the function's end: a `}` at column 0 inside
    // a quoted string would truncate the slice and everything below it would
    // escape the ban unscanned (re-review N2). The final statement is the pin.
    expect(fn, 'the scan window must reach cmd_pr_open\'s last statement')
      .toContain(`printf '%s\\n' "$opened"`);
    for (const banned of ['--body-file', '--template', '--fill', '--force', '"$@"',
                          '-C "$workdir"']) {
      expect(fn, `cmd_pr_open must not contain ${banned}`).not.toContain(banned);
    }
    // -F separately, as a boundary regex: the literal '-F ' misses pflag's
    // attached shorthand -F<path> — `-F"$HOME/.config/gh/hosts.yml"` is the
    // token file as the PR body (re-review N3). (^|\s)-F catches both forms
    // without matching --fill or --force, which the loop above bans anyway.
    expect(fn, 'cmd_pr_open must not contain -F in any form').not.toMatch(/(^|\s)-F/m);
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
    // The bound is measured on the BODY, not on its encoding: base64 of 60000
    // bytes is 80000, so a `wc -c` on `$b64` would refuse a body comfortably
    // under the limit. The existing PR fixture keeps this to the size guard —
    // nothing is pushed, so what is asserted is that the body got through it.
    h.ghRows([{ number: 1, url: 'u', state: 'OPEN', isDraft: false }]);
    expect(open('', 'demo-quiet-basin', 't', 'x'.repeat(60000)).code).toBe(0);
  });

  it('refuses a body that is not valid UTF-8', () => {
    // gh sends the body as JSON, and an invalid sequence is refused by the API
    // — but only after the branch has been pushed. This check is before it, and
    // it had no fixture at all.
    workspace('demo', 'quiet-basin');
    const bad = Buffer.from([0xff, 0xfe, 0x41]).toString('base64');
    const r = h.run(`${GH_STUB} cmd_pr_open --session demo-quiet-basin --title t --body-b64 '${bad}' --draft false`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/body is not valid UTF-8/);
    expect(h.ghCalls()).toEqual([]);
  });

  it('rejects a --draft value that is not true or false', () => {
    workspace('demo', 'quiet-basin');
    expect(open('', 'demo-quiet-basin', 't', 'b', 'maybe').stderr).toMatch(/bad --draft/);
    // The EMPTY value is the one that matters: `${8:-false}` reads a --draft
    // nobody set as `false` and opens a REAL PR for a request that never said
    // so. `$8` is set-and-empty here, so it fails the check instead.
    expect(open('', 'demo-quiet-basin', 't', 'b', '').stderr).toMatch(/bad --draft/);
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

  it('refuses an incomplete registry instead of pushing with the fields it did find', () => {
    // Without the guard `base` is empty, `baseShort` is empty, `head equals
    // base` cannot fire, and the verb pushes and then asks gh to open a PR
    // against `--base ""`.
    workspace('demo', 'quiet-basin');
    fs.rmSync(path.join(h.home, '.cc-sessions', 'demo-quiet-basin.base'));
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/incomplete registry for 'demo-quiet-basin'/);
    expect(h.ghCalls()).toEqual([]);
    expect(() => h.git(path.join(h.home, 'origins', 'demo.git'), 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'))
      .toThrow();
  });

  it('refuses a project whose main checkout has no origin', () => {
    // `_gh_repo_slug` answers non-zero and prints nothing, so without the
    // `|| die` the slug is the empty string and `--repo ""` is what reaches gh.
    workspace('demo', 'quiet-basin');
    h.git(path.join(h.home, 'projects', 'demo'), 'remote', 'remove', 'origin');
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/no origin remote for demo/);
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

  it('answers with the PR rows and nothing else, in ONE shape on both paths', () => {
    // The create path's stdout had never been asserted, and it was not JSON:
    // `git push --set-upstream` writes "branch 'x' set up to track 'origin/x'."
    // to STDOUT, so the verb's answer was that sentence followed by the rows.
    // Dropping the read-back entirely, or its `isDraft`, both left the suite
    // green. The Interfaces block promises "the PR as JSON on stdout".
    workspace('demo', 'quiet-basin');
    const row = { number: 9, url: 'https://github.com/o/r/pull/9', state: 'OPEN', isDraft: false };
    h.ghRows([row]);
    const created = h.run(`${GH_STUB} ${GH_CREATES} cmd_pr_open --session demo-quiet-basin --title t --body-b64 ${b64('b')} --draft false`);
    expect(created.code).toBe(0);
    expect(JSON.parse(created.stdout)).toEqual([row]);

    // ...and the idempotent path answers the same shape from the same reader,
    // where the two calls used to ask for `number,url,state` and
    // `number,url,state,isDraft` — a caller could tell the paths apart by
    // whether `isDraft` was there at all. Run second, against the PR the first
    // one opened, which is exactly the case idempotence is for.
    const existing = open();
    expect(existing.code).toBe(0);
    expect(JSON.parse(existing.stdout)).toEqual([row]);
  });

  it('asks gh ONE bounded question, the same one on both calls, always under timeout', () => {
    // The stub logs the argv it was handed and `timeout` logs its own, which is
    // the only way any of this is assertable: the stub answers whatever it is
    // asked, so `--state all` -> `--state open` and a dropped `timeout` are
    // both invisible behaviourally. `PR_GH_TIMEOUT` is the only bound there is
    // on a 30 s blocking DNS hang.
    workspace('demo', 'quiet-basin');
    h.ghRows([{ number: 9, url: 'u', state: 'OPEN', isDraft: false }]);
    expect(h.run(`${GH_STUB} ${GH_CREATES} cmd_pr_open --session demo-quiet-basin --title t --body-b64 ${b64('b')} --draft false`).code).toBe(0);
    const asked = 'pr list --repo o/r --head ws/quiet-basin --state all --limit 100 '
      + '--json number,state,headRefName,headRefOid,baseRefName,isCrossRepository,'
      + 'mergedAt,mergeCommit,url,title,isDraft,statusCheckRollup';
    // Exactly twice, byte for byte, and never a third time: --state all (a
    // CLOSED PR on this branch must read as "exists"), the 100-PR window, the
    // head filter that scopes it to this branch, and every field the answer is
    // supposed to carry.
    expect(h.ghCalls().filter((c) => c.startsWith('pr list'))).toEqual([asked, asked]);
    expect(h.ghCalls().filter((c) => c.startsWith('timeout '))).toEqual([
      `timeout 12 gh ${asked}`,
      'timeout 12 gh pr create --repo o/r --head ws/quiet-basin --base main --title t --body b',
      `timeout 12 gh ${asked}`,
    ]);
  });

  it('pushes a refspec that is fully qualified on BOTH sides', () => {
    // A bare `ws/quiet-basin` still pushes correctly in an ordinary fixture, so
    // the qualified form Global Constraints require was unpinned. A tag of the
    // same name is what tells them apart: measured, `git push origin
    // ws/quiet-basin` with both refs/heads/ws/quiet-basin and
    // refs/tags/ws/quiet-basin present is "src refspec … matches more than
    // one", while refs/heads/…:refs/heads/… names exactly one ref on each side.
    // A same-named tag is ordinary — release tooling makes them from branch
    // names — and here it would turn the one bounded write into a hard failure,
    // or, on the remote side, into a push at a tag.
    const main = path.join(h.home, 'projects', 'demo');
    workspace('demo', 'quiet-basin');
    h.git(main, 'tag', 'ws/quiet-basin');
    h.ghRows([]);
    const r = open();
    expect(r.code).toBe(0);
    expect(h.git(path.join(h.home, 'origins', 'demo.git'), 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'))
      .toBe(h.git(main, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'));
  });

  it('names the state a failed create leaves behind — the branch IS on origin', () => {
    // The push is kept: rolling it back would be a destructive rollback of a
    // lossless state (the ref is the workspace's own work, and a later retry
    // needs it there). So the message has to name what it left, the way the
    // push's own refusal says "nothing was opened" about a state where truly
    // nothing was. The route (Task 13) surfaces exactly this stderr in its 502.
    const wt = workspace('demo', 'quiet-basin');
    const origin = path.join(h.home, 'origins', 'demo.git');
    const r = h.run(`${GH_STUB}
      gh() { printf '%s\\n' "$*" >> "$HOME/gh-calls"
             case "$1 $2" in "pr create") return 1 ;; esac
             echo '[]'; }
      cmd_pr_open --session demo-quiet-basin --title t --body-b64 ${b64('b')} --draft false`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(
      /gh pr create failed — ws\/quiet-basin is on origin with its upstream set, but no PR was opened/);
    // ...and the state the message names is the state that is really there.
    expect(h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'))
      .toBe(h.git(wt, 'rev-parse', 'HEAD'));
    expect(h.git(wt, 'rev-parse', '--abbrev-ref', '@{upstream}')).toBe('origin/ws/quiet-basin');
  });

  it('returns a CLOSED PR on the branch rather than opening a second one', () => {
    // --state all, said behaviourally: `--state open` would answer [] here and
    // open a duplicate over an abandoned PR's branch.
    workspace('demo', 'quiet-basin');
    h.ghRows([{ number: 3, url: 'https://github.com/o/r/pull/3', state: 'CLOSED', isDraft: false }]);
    const r = open();
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)[0].state).toBe('CLOSED');
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
  });
});

/** A bounded write may not proceed on an UNPROVEN "no PR exists". Every one of
 *  these used to read as "no PR": rc 124, rc 1 with an expired token, and an
 *  rc-0 body that is not a list at all — the probe captured stdout alone, so
 *  all three arrived as the empty string, and the verb pushed and created
 *  anyway. The loss is a duplicate PR whenever the existing one is
 *  cross-repository, because our own create then succeeds. */
describe('the existence probe fails closed', () => {
  it('refuses when the probe times out — nothing pushed, nothing created', () => {
    workspace('demo', 'quiet-basin');
    const origin = path.join(h.home, 'origins', 'demo.git');
    h.ghFail(124, '');
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not check for an existing PR on ws\/quiet-basin \(timeout\) — nothing was pushed/);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    expect(() => h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin')).toThrow();
  });

  it('says WHICH failure it was — an expired token is not a timeout', () => {
    // The classification is `_gh_pr_list`'s, and it is the whole reason this
    // verb reuses that read instead of open-coding `gh pr list` a third time.
    workspace('demo', 'quiet-basin');
    h.ghFail(1, 'gh: HTTP 401: Bad credentials\n');
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not check for an existing PR on ws\/quiet-basin \(unauthenticated\)/);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
  });

  it('says GitHub was unwell when GitHub was unwell — not that it could not be read', () => {
    // The other half of "one reader": a token the classifier learns for
    // `pr-state` reaches this verb's refusal sentence for free, because the
    // sentence quotes `_gh_pr_list`'s own answer object rather than restating a
    // vocabulary. The distinction is worth as much here as on the phone —
    // `(error)` sends the operator to check `gh auth` for a probe that failed
    // because api.github.com could not finish a query.
    workspace('demo', 'quiet-basin');
    const origin = path.join(h.home, 'origins', 'demo.git');
    h.ghFail(1, "HTTP 504: We couldn't respond to your request in time. (https://api.github.com/graphql)\n");
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not check for an existing PR on ws\/quiet-basin \(unavailable\)/);
    expect(r.stderr).not.toMatch(/\(error\)/);
    // Fails CLOSED exactly as every other classified failure does: an
    // unmeasured "no PR exists" may not be spent on a push or a create.
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    expect(() => h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin')).toThrow();
  });

  it('refuses an rc-0 body that is not a list of PRs, instead of answering with it', () => {
    // `gh` writes its own diagnostics to STDOUT at rc 0. The route (Task 13)
    // answers {ok:true} on rc 0 without parsing stdout, so this exact string
    // used to reach the phone as "the PR opened", having pushed nothing and
    // created nothing.
    workspace('demo', 'quiet-basin');
    const origin = path.join(h.home, 'origins', 'demo.git');
    h.ghRaw('gh: could not determine base repository\n');
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not a list of PRs — nothing was pushed/);
    expect(r.stdout).not.toContain('could not determine base repository');
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    expect(() => h.git(origin, 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin')).toThrow();
  });

  it('refuses an rc-0 body that PARSES but is not a list', () => {
    // `{"message":"Not Found"}` is what the API says about a repo the token
    // cannot see, and it is perfectly good JSON: a check that only asked
    // "does it parse" would take it for an answer and push underneath it.
    workspace('demo', 'quiet-basin');
    h.ghRaw('{"message":"Not Found"}\n');
    const r = open();
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/not a list of PRs — nothing was pushed/);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
  });

  it('says the PR WAS opened when the read-back fails, and answers nothing', () => {
    // The read-back is the same read, so it fails the same way — but the truth
    // it reports is different, and it is the difference between "retry" and
    // "look before you retry".
    workspace('demo', 'quiet-basin');
    const r = h.run(`${GH_STUB}
      gh() { printf '%s\\n' "$*" >> "$HOME/gh-calls"
             case "$1 $2" in "pr create") touch "$HOME/gh-created"; return 0 ;; esac
             [[ -f "$HOME/gh-created" ]] && return 124
             echo '[]'; }
      cmd_pr_open --session demo-quiet-basin --title t --body-b64 ${b64('b')} --draft false`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the PR was opened, but reading it back failed \(timeout\)/);
    expect(r.stdout).toBe('');
  });

  it('never answers with a read-back body that is not a list either', () => {
    workspace('demo', 'quiet-basin');
    const r = h.run(`${GH_STUB}
      gh() { printf '%s\\n' "$*" >> "$HOME/gh-calls"
             case "$1 $2" in "pr create") touch "$HOME/gh-created"; return 0 ;; esac
             if [[ -f "$HOME/gh-created" ]]; then echo 'gh: could not determine base repository'
             else echo '[]'; fi; }
      cmd_pr_open --session demo-quiet-basin --title t --body-b64 ${b64('b')} --draft false`);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/the PR was opened, but gh answered something that is not a list of PRs/);
    expect(r.stdout).not.toContain('could not determine base repository');
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

  it('reads the record from $main, so a stranger at $workdir cannot veto the push', () => {
    // Deviation 4's core claim, on the write path. Corroborating from the
    // DIRECTORY (`_ws_wt_branch "$workdir" "$workdir"`) survives all three
    // rungs above, because a stranger repo that happens to be on the same
    // branch NAME answers the same string. A stranger on a DIFFERENT branch is
    // what tells them apart: $main's record still says ws/quiet-basin and the
    // write proceeds with $main's ref, while the directory says attacker/main —
    // which refuses a write this verb is entitled to make, and prints a
    // stranger's branch name inside our own refusal while doing it.
    const wt = workspace('demo', 'quiet-basin');
    const main = path.join(h.home, 'projects', 'demo');
    const ours = h.git(main, 'rev-parse', 'refs/heads/ws/quiet-basin');
    fs.rmSync(wt, { recursive: true, force: true });
    fs.mkdirSync(wt, { recursive: true });
    h.git(wt, 'init', '-q', '-b', 'attacker/main');
    fs.writeFileSync(path.join(wt, 'evil.txt'), 'evil\n');
    h.git(wt, 'add', 'evil.txt');
    h.git(wt, 'commit', '-m', 'stranger work');
    // The record in $main is untouched by any of that, which is the premise.
    expect(h.sh(`_ws_wt_branch "${main}" "${wt}"`)).toBe('ws/quiet-basin');

    h.ghRows([]);
    const r = open();
    expect(r.code).toBe(0);
    expect(r.stderr).not.toMatch(/attacker\/main/);
    expect(h.git(path.join(h.home, 'origins', 'demo.git'), 'rev-parse', '--verify', 'refs/heads/ws/quiet-basin'))
      .toBe(ours);
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

/** The verb reached through the DISPATCHER, the way the box reaches it: the real
 *  file as a program, not a sourced copy. The caps-parity test only proves the
 *  arm's LABEL exists, and every test above calls `cmd_pr_open` directly after
 *  `source`, so `pr-open)` could have invoked cmd_pr_state — or dropped its
 *  `shift` — and shipped green. */
describe('the dispatcher', () => {
  const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
    const opts = {
      encoding: 'utf8' as const, cwd: h.home,
      env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
    };
    try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
    catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
    }
  };

  it('routes pr-open to cmd_pr_open, with argv shifted', () => {
    // Eight tokens after the verb, and a session id the regex refuses. Only
    // cmd_pr_open answers that with `bad session id`: cmd_pr_state's own arity
    // rung fires first on eight arguments and prints ITS usage line, and an arm
    // that forgot its `shift` hands over nine and prints pr-open's usage line.
    // The refusal is before any path, any gh call and any git call, so this
    // costs the fixture nothing.
    const r = runCcd('pr-open', '--session', '../../etc/passwd', '--title', 't',
      '--body-b64', b64('b'), '--draft', 'false');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/bad session id/);
    expect(r.stderr).not.toMatch(/usage:/);
    expect(h.ghPoison()).toEqual([]);
  });

  it('names pr-open in the usage line a mistyped verb prints', () => {
    // Not covered by the caps parity test, which compares the caps list with
    // the dispatcher's arms and never reads this string.
    const r = runCcd('no-such-verb');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('usage: ccd {');
    expect(r.stderr).toContain('pr-open');
  });
});
