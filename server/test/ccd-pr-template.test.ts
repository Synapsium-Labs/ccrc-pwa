import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ccdSource } from './ccdWsHelpers.js';
import { makePrHarness, type PrHarness } from './ccdPrHelpers.js';

let h: PrHarness;
beforeEach(() => { h = makePrHarness('ccrc-ccd-prtmpl-'); });
afterEach(() => { h.cleanup(); });

/** A gh that answers by verb from files in $HOME: `gh api` prints gh-meta; `gh pr list` prints gh-rows.json, or
 *  gh-rows-after.json once `gh pr create` has run; `gh pr create` prints a URL (or fails when gh-create-fail exists). */
const GH = `
gh() {
  printf '%s\\n' "$*" >> "$HOME/gh-calls"
  case "$1" in
    api) cat "$HOME/gh-meta" ;;
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
].join('\n');
const BRANCH = 'ccrc/linking-template';
const openRow = { number: 9, state: 'OPEN', headRefName: BRANCH, baseRefName: 'main', isCrossRepository: false,
  mergedAt: null, mergeCommit: null, url: 'https://github.com/owner/repo/pull/9', title: 't', isDraft: false, headRefOid: 'abc' };

const put = (n: string, body: string): void => { fs.writeFileSync(path.join(h.home, n), body); };
const origin = (): string => path.join(h.home, 'origins', 'demo.git');
const setup = (meta = 'private\tmain\n'): string => {
  const main = h.makeGhRepo('demo', 'owner/repo');
  put('gh-meta', meta); put('gh-rows.json', '[]'); put('gh-rows-after.json', JSON.stringify([openRow]));
  return main;
};
const run = (args: string) => h.run(`${GH} cmd_pr_template ${args}`);
const hasBranch = (): boolean => h.git(origin(), 'for-each-ref', '--format=%(refname)', `refs/heads/${BRANCH}`) !== '';
const noTemp = (): void => {
  expect(fs.readdirSync(path.join(h.home, 'projects')).filter((n) => n.startsWith('.pr-template.'))).toEqual([]);
  expect(h.git(path.join(h.home, 'projects', 'demo'), 'worktree', 'list').split('\n')).toHaveLength(1);
};

describe('ccd pr-template (D-8147)', () => {
  it('opens a PR from ccrc/linking-template adding the template with the team key', () => {
    setup();
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    const rows = JSON.parse(r.stdout.split('\n')[0]!) as Array<{ number: number }>;
    expect(rows[0]!.number).toBe(9);
    expect(h.git(origin(), 'show', `${BRANCH}:.github/pull_request_template.md`)).toBe(TEMPLATE);
    const create = h.ghCalls().find((c) => c.startsWith('pr create'))!;
    expect(create).toContain('--repo owner/repo');
    expect(create).toContain(`--head ${BRANCH}`);
    expect(create).toContain('--base main');
    noTemp();
  });

  it('never pushes the default branch', () => {
    setup();
    const before = h.git(origin(), 'rev-parse', 'refs/heads/main');
    expect(run('--project demo --team KEY').code).toBe(0);
    expect(h.git(origin(), 'rev-parse', 'refs/heads/main')).toBe(before);
    expect(h.git(origin(), 'for-each-ref', '--format=%(refname)').split('\n').sort())
      .toEqual(['refs/heads/ccrc/linking-template', 'refs/heads/main']);
    expect(ccdSource()).not.toMatch(/push[^\n]*--force/);
  });

  it('refuses repo-public and pushes nothing', () => {
    setup('public\tmain\n');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ reason: 'repo-public' });
    expect(hasBranch()).toBe(false);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noTemp();
  });

  it('refuses template-exists when the default branch holds one', () => {
    const main = setup();
    fs.mkdirSync(path.join(main, '.github'), { recursive: true });
    fs.writeFileSync(path.join(main, '.github', 'pull_request_template.md'), 'x\n');
    h.git(main, 'add', '.github/pull_request_template.md');
    h.git(main, 'commit', '-m', 'template');
    h.git(main, 'push', 'origin', 'main');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout)).toEqual({ reason: 'template-exists' });
    expect(hasBranch()).toBe(false);
    noTemp();
  });

  it('answers the open PR when the branch already has one', () => {
    setup();
    put('gh-rows.json', JSON.stringify([openRow]));
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    expect((JSON.parse(r.stdout.split('\n')[0]!) as Array<{ number: number }>)[0]!.number).toBe(9);
    expect(hasBranch()).toBe(false);
    expect(h.ghCalls().some((c) => c.startsWith('pr create'))).toBe(false);
    noTemp();
  });

  it('removes its temp worktree on every path', () => {
    setup();
    put('gh-create-fail', '');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/gh pr create failed/);
    noTemp();
    fs.rmSync(path.join(h.home, 'gh-create-fail'));
    // The branch the failed create left on origin is reused: no second push, only the PR.
    expect(hasBranch()).toBe(true);
    noTemp();
  });

  it('retries after a failed create: reuses the branch on origin and only opens the PR', () => {
    setup();
    put('gh-create-fail', '');
    expect(run('--project demo --team KEY').code).toBe(1);
    fs.rmSync(path.join(h.home, 'gh-create-fail'));
    const tip = h.git(origin(), 'rev-parse', `refs/heads/${BRANCH}`);
    const main = path.join(h.home, 'projects', 'demo');
    fs.writeFileSync(path.join(main, 'x.txt'), 'x\n');
    h.git(main, 'add', 'x.txt'); h.git(main, 'commit', '-m', 'x'); h.git(main, 'push', 'origin', 'main');
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    expect(h.git(origin(), 'rev-parse', `refs/heads/${BRANCH}`)).toBe(tip);
    expect(h.ghCalls().filter((c) => c.startsWith('pr create'))).toHaveLength(2);
    noTemp();
  });

  it('opens a new PR over a leftover branch when the earlier PR was closed unmerged', () => {
    setup();
    expect(run('--project demo --team KEY').code).toBe(0);
    const tip = h.git(origin(), 'rev-parse', `refs/heads/${BRANCH}`);
    fs.rmSync(path.join(h.home, 'gh-created'));
    put('gh-rows.json', JSON.stringify([{ ...openRow, state: 'CLOSED' }]));
    const r = run('--project demo --team KEY');
    expect(r.code, r.stderr).toBe(0);
    expect(h.git(origin(), 'rev-parse', `refs/heads/${BRANCH}`)).toBe(tip);
    expect(h.ghCalls().filter((c) => c.startsWith('pr create'))).toHaveLength(2);
    noTemp();
  });

  it('still reports a push refusal when the leftover branch does not hold the template', () => {
    const main = setup();
    h.git(main, 'checkout', '-q', '-b', BRANCH);
    fs.writeFileSync(path.join(main, 'other.txt'), 'o\n');
    h.git(main, 'add', 'other.txt'); h.git(main, 'commit', '-m', 'other'); h.git(main, 'push', 'origin', BRANCH);
    h.git(main, 'checkout', '-q', 'main');
    const r = run('--project demo --team KEY');
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/push failed/);
    noTemp();
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
