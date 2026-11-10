import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ccdSource } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prtmpl-'); });
afterEach(() => { h.cleanup(); });

/** A gh that models the GitHub side in files under $HOME, so the assertions read what ccd ASKED GitHub, not what it wrote
 *  here: `gh api repos/owner/repo` prints gh-meta; the default branch's ref prints gh-tip; the template's ref
 *  `ccrc/linking-template` exists once gh-branch does (a POST to git/refs makes it); the template file exists on the
 *  default branch when gh-default-template does and on the branch when gh-branch-template does (a PUT to contents makes it,
 *  and keeps the content field in gh-put-content). A missing thing answers `HTTP 404` on stderr, rc 1; gh-fail-on (a word)
 *  makes every call whose argv contains it answer gh-fail-text on stderr with rc 1. `gh pr list` prints gh-rows.json, or
 *  gh-rows-after.json once `gh pr create` has run; `gh pr create` prints a URL (or fails when gh-create-fail exists).
 *  \`git\` is wrapped to log every call, so "no git writes" is an assertion over the log. */
const GH = `
git() { printf '%s\\n' "$*" >> "$HOME/git-calls"; command git "$@"; }
gh() {
  printf '%s\\n' "$*" >> "$HOME/gh-calls"
  local a content=""
  [[ -f "$HOME/gh-fail-on" && "$*" == *"$(cat "$HOME/gh-fail-on")"* ]] && { cat "$HOME/gh-fail-text" >&2; return 1; }
  case "$1" in
    api)
      for a in "$@"; do case "$a" in content=*) content="\${a#content=}" ;; esac; done
      case " $* " in
        *" -X POST "*git/refs*) : > "$HOME/gh-branch"; echo refs/heads/ccrc/linking-template ;;
        *" -X PUT "*contents/*) printf '%s' "$content" > "$HOME/gh-put-content"; : > "$HOME/gh-branch-template"; echo cafe ;;
        *git/ref/heads/ccrc/linking-template*) [[ -f "$HOME/gh-branch" ]] && echo 5555555555555555555555555555555555555555 \\
          || { echo 'gh: Not Found (HTTP 404)' >&2; return 1; } ;;
        *git/ref/heads/*) cat "$HOME/gh-tip" ;;
        *contents/*ref=ccrc/linking-template*) [[ -f "$HOME/gh-branch-template" ]] && echo .github/pull_request_template.md \\
          || { echo 'gh: Not Found (HTTP 404)' >&2; return 1; } ;;
        *contents/*) [[ -f "$HOME/gh-default-template" ]] && echo .github/pull_request_template.md \\
          || { echo 'gh: Not Found (HTTP 404)' >&2; return 1; } ;;
        *) cat "$HOME/gh-meta" ;;
      esac ;;
    pr)
      case "$2" in
        list) if [[ -f "$HOME/gh-created" ]]; then cat "$HOME/gh-rows-after.json"; else cat "$HOME/gh-rows.json"; fi ;;
        create) [[ -f "$HOME/gh-create-fail" ]] && { echo 'boom' >&2; return 1; }
                : > "$HOME/gh-created"; echo 'https://github.com/owner/repo/pull/9' ;;
      esac ;;
  esac
  return 0
}
timeout() { case "$1" in -*) return 125 ;; esac; printf 'timeout %s\\n' "$*" >> "$HOME/gh-calls"; shift; "$@"; };
`;
const TEMPLATE = [
  "<!-- Linking: name this PR's Linear ticket so Linear links it and acts on merge. -->",
  "<!-- Closes KEY-<n> when merging this PR meets the ticket's acceptance; Refs KEY-<n> when a live check is still owed. -->",
  'Closes KEY-', '', '## Summary', '', '## Test plan',
].join('\n') + '\n';
const BRANCH = 'ccrc/linking-template';
const TIP = '1111111111111111111111111111111111111111';
const REL = '.github/pull_request_template.md';
const openRow = { number: 9, state: 'OPEN', headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false,
  mergedAt: null, mergeCommit: null, url: 'https://github.com/owner/repo/pull/9', title: 't', isDraft: false, headRefOid: 'abc' };

const put = (n: string, body = ''): void => { fs.writeFileSync(path.join(h.home, n), body); };
const failOn = (word: string, text: string): void => { put('gh-fail-on', word); put('gh-fail-text', text); };
const has = (n: string): boolean => fs.existsSync(path.join(h.home, n));
const setup = (meta = 'private\tmain\n'): string => {
  const main = h.makeGhRepo('demo', 'owner/repo');
  put('gh-meta', meta); put('gh-tip', `${TIP}\n`); put('gh-rows.json', '[]'); put('gh-rows-after.json', JSON.stringify([openRow]));
  return main;
};
const run = (args: string) => h.run(`${GH} cmd_pr_template ${args}`);
const mainRepo = (): string => path.join(h.home, 'projects', 'demo');
/** Everything a git write could touch in the main checkout: every ref, the object count and FETCH_HEAD. */
const repoState = (): string => [
  h.git(mainRepo(), 'for-each-ref', '--format=%(refname) %(objectname)'),
  h.git(mainRepo(), 'count-objects', '-v'),
  fs.existsSync(path.join(mainRepo(), '.git', 'FETCH_HEAD')) ? 'FETCH_HEAD' : 'no-FETCH_HEAD',
].join('\n---\n');
const gitCalls = (): string[] => (has('git-calls') ? fs.readFileSync(path.join(h.home, 'git-calls'), 'utf8').split('\n').filter(Boolean) : []);
/** The gh api calls, without the `timeout` wrapper lines. */
const apiCalls = (): string[] => h.ghCalls().filter((c) => c.startsWith('api '));
const noGitWrites = (): void => {
  // The only git call is the slug read; no ref, object or FETCH_HEAD of the main checkout moved.
  expect(gitCalls().filter((c) => !/config --get remote\.origin\.url$/.test(c))).toEqual([]);
  expect(h.git(mainRepo(), 'for-each-ref', '--format=%(refname)')).toContain('refs/heads/main');
  expect(h.git(mainRepo(), 'for-each-ref', '--format=%(refname)', 'refs/heads')).toBe('refs/heads/main');
  expect(h.git(mainRepo(), 'for-each-ref', '--format=%(refname)', 'refs/remotes/origin/ccrc')).toBe('');
  expect(h.git(mainRepo(), 'worktree', 'list').split('\n')).toHaveLength(1);
  expect(fs.readdirSync(path.join(h.home, 'projects')).filter((n) => n.startsWith('.pr-template.'))).toEqual([]);
};

describe('ccd pr-template (D-8147)', () => {
  it('creates the branch, puts the template and opens the PR through gh api, writing nothing on the box', () => {
    setup();
    const before = repoState();
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    const rows = JSON.parse(r.stdout.split('\n')[0]!) as Array<{ number: number }>;
    expect(rows[0]!.number).toBe(9);
    // The exact GitHub-side sequence: meta, tip of the default branch, the template there, the branch ref, create, put.
    const calls = apiCalls();
    expect(calls).toHaveLength(6);
    expect(calls[0]).toBe('api repos/owner/repo --jq [.visibility,.default_branch]|@tsv');
    expect(calls[1]).toBe('api repos/owner/repo/git/ref/heads/main --jq .object.sha');
    expect(calls[2]).toBe(`api repos/owner/repo/contents/${REL}?ref=main --jq .path`);
    expect(calls[3]).toBe(`api repos/owner/repo/git/ref/heads/${BRANCH} --jq .object.sha`);
    expect(calls[4]).toBe(`api -X POST repos/owner/repo/git/refs -f ref=refs/heads/${BRANCH} -f sha=${TIP} --jq .ref`);
    expect(calls[5]).toMatch(new RegExp(`^api -X PUT repos/owner/repo/contents/${REL.replace(/\./g, '\\.')} -f message=Add a pull request template that names the Linear ticket -f content=\\S+ -f branch=${BRANCH} --jq \\.commit\\.sha$`));
    expect(Buffer.from(fs.readFileSync(path.join(h.home, 'gh-put-content'), 'utf8'), 'base64').toString('utf8')).toBe(TEMPLATE);
    const create = h.ghCalls().find((c) => c.startsWith('pr create'))!;
    expect(create).toContain('--repo owner/repo');
    expect(create).toContain(`--head ${BRANCH}`);
    expect(create).toContain('--base main');
    // Every GitHub call went through the timeout wrapper.
    expect(h.ghCalls().filter((c) => c.startsWith('timeout ')).every((c) => /^timeout \d+ gh /.test(c))).toBe(true);
    expect(h.ghCalls().filter((c) => c.startsWith('timeout ')).length).toBeGreaterThanOrEqual(9);
    expect(repoState()).toBe(before);
    noGitWrites();
  });

  it('never writes the default branch: the only ref created or filled is ccrc/linking-template', () => {
    setup();
    expect(run('--project demo --team KEY').code).toBe(0);
    for (const c of apiCalls().filter((x) => x.includes('-X '))) {
      expect(c, c).toMatch(new RegExp(`(-f ref=refs/heads/${BRANCH} |-f branch=${BRANCH} )`));
      expect(c, c).not.toMatch(/refs\/heads\/main|branch=main/);
    }
    expect(ccdSource()).not.toMatch(/push[^\n]*--force/);
    expect(ccdSource()).not.toMatch(/git[^\n]*push origin [^\n]*linking-template/);
  });

  it('refuses repo-public before any ref or file read', () => {
    setup('public\tmain\n');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ reason: 'repo-public' });
    expect(apiCalls()).toHaveLength(1);
    expect(has('gh-branch')).toBe(false);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noGitWrites();
  });

  it('refuses template-exists when the default branch holds one, and creates nothing', () => {
    setup();
    put('gh-default-template');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ reason: 'template-exists' });
    expect(apiCalls().some((c) => c.includes('-X '))).toBe(false);
    expect(has('gh-branch')).toBe(false);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noGitWrites();
  });

  it('answers the open PR when the branch already has one, before any ref read', () => {
    setup();
    put('gh-rows.json', JSON.stringify([openRow]));
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout.split('\n')[0]!) as Array<{ number: number }>)[0]!.number).toBe(9);
    expect(apiCalls()).toHaveLength(1);
    expect(has('gh-branch')).toBe(false);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noGitWrites();
  });

  it('a failed create leaves the branch and the template on GitHub, and the retry only opens the PR', () => {
    setup();
    put('gh-create-fail');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gh pr create failed/);
    expect(has('gh-branch')).toBe(true);
    expect(has('gh-branch-template')).toBe(true);
    noGitWrites();
    fs.rmSync(path.join(h.home, 'gh-create-fail'));
    fs.writeFileSync(path.join(h.home, 'gh-calls'), '');
    const again = run('--project demo --team KEY');
    expect(again.code, again.stderr).toBe(0);
    expect(apiCalls().some((c) => c.includes('-X '))).toBe(false);
    expect(h.ghCalls().filter((c) => c.startsWith('pr create'))).toHaveLength(1);
    noGitWrites();
  });

  it('opens a new PR over a leftover branch when the earlier PR was closed unmerged, writing nothing', () => {
    setup();
    expect(run('--project demo --team KEY').code).toBe(0);
    fs.rmSync(path.join(h.home, 'gh-created'));
    put('gh-rows.json', JSON.stringify([{ ...openRow, state: 'CLOSED' }]));
    fs.writeFileSync(path.join(h.home, 'gh-calls'), '');
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    expect(apiCalls().some((c) => c.includes('-X '))).toBe(false);
    expect(h.ghCalls().filter((c) => c.startsWith('pr create'))).toHaveLength(1);
    noGitWrites();
  });

  it('puts the template on a leftover branch that lacks it, without creating the ref again', () => {
    setup();
    put('gh-branch');
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    const writes = apiCalls().filter((c) => c.includes('-X '));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('-X PUT');
    expect(writes[0]).not.toContain('git/refs');
    expect(has('gh-branch-template')).toBe(true);
    noGitWrites();
  });

  it.each([
    ['the default branch tip', 'git/ref/heads/main', /could not read main on GitHub/],
    ['the template on the default branch', 'contents/.github/pull_request_template.md?ref=main', /could not read the template on main/],
    ['the branch', 'git/ref/heads/ccrc/linking-template', /could not read ccrc\/linking-template \(rate-limit\)/],
  ])('a failed read of %s opens nothing and says so', (_n, needle, msg) => {
    setup();
    failOn(needle, 'HTTP 403: API rate limit exceeded\n');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(has('gh-branch')).toBe(false);
    expect(apiCalls().some((c) => c.includes('-X '))).toBe(false);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noGitWrites();
  });

  it('a failed branch create stops before the file is put or the PR opened', () => {
    setup();
    failOn('-X POST', 'HTTP 422: Reference already exists\n');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not create ccrc\/linking-template/);
    expect(apiCalls().some((c) => c.includes('-X PUT'))).toBe(false);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noGitWrites();
  });

  it('a failed file put stops before the PR is opened', () => {
    setup();
    failOn('-X PUT', 'HTTP 409: conflict\n');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/could not put the template on ccrc\/linking-template/);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noGitWrites();
  });

  it('ccd writes no hash-object, temporary index, commit or push for the template', () => {
    const src = ccdSource();
    const start = src.indexOf('cmd_pr_template() {');
    const body = src.slice(start, src.indexOf('cmd_pr_state() {'));
    expect(body).not.toMatch(/hash-object|read-tree|update-index|write-tree|commit-tree|FETCH_HEAD|git -C "\$main" (push|fetch)|_plat_mktemp_d/);
  });

  it('refuses a team key outside the shape before any read', () => {
    setup();
    for (const key of ['key', 'K Y', '1K', 'KEY-1', 'TOO_LONG_KEY_NAME_X', '']) {
      const r = run(`--project demo --team "${key}"`);
      expect(r.code, key).toBe(1);
      expect(r.stderr, key).toMatch(/bad team key/);
    }
    expect(h.ghCalls()).toEqual([]);
  });

  it('refuses an invalid project name before any read', () => {
    setup();
    expect(run('--project "a b" --team KEY').stderr).toMatch(/bad project/);
    expect(run('--project ../x --team KEY').stderr).toMatch(/bad project/);
    for (const bad of ['..', '.', '.hidden', '-x']) expect(run(`--project ${bad} --team KEY`).stderr, bad).toMatch(/bad project/);
    expect(h.ghCalls()).toEqual([]);
  });

  it('answers no-remote for a checkout with no github origin', () => {
    h.makeRepo('plain');
    const r = run('--project plain --team KEY');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ reason: 'no-remote' });
  });

  it('exact arity: any other argv is the usage line', () => {
    setup();
    for (const argv of ['', '--project demo', '--team KEY', '--team KEY --project demo', '--project demo --team KEY x',
      '--project demo --team KEY --force']) {
      const r = run(argv);
      expect(r.code, argv).toBe(1);
      expect(r.stderr, argv).toMatch(/usage: ccd pr-template --project <p> --team <KEY>/);
    }
    expect(h.ghCalls()).toEqual([]);
    expect(h.ghPoison()).toEqual([]);
  });

  it('is a listed verb and is dispatched', () => {
    expect(h.sh('true; cmd_caps').split('\n')).toContain('pr-template');
    expect(ccdSource()).toContain('pr-template) shift; cmd_pr_template "$@" ;;');
  });
});
