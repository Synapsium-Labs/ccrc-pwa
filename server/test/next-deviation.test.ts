import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_ALLOC_MAX, nextDeviationNumbers, selfAssignedCollisions } from '../src/coord/ledger.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { DEFINITION_DIRS, changedDefinitionPaths, readDefinitionFilesAt, resolveLedgerBase, staleLedgerBase } from '../scripts/next-deviation.js';

afterEach(() => removeTmpFixtures());

const d = (n: number, file = 'docs/superpowers/plans/a.md') => ({ file, n });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.resolve(HERE, '../node_modules/.bin/tsx');
const SCRIPT = path.resolve(HERE, '../scripts/next-deviation.ts');
const D = (n: number) => 'D-' + n; // built, so no scanner reads a deviation ref here

type Tree = Record<string, string>;
/** A repo whose `origin/main` holds `base` and whose HEAD adds `head` on top. */
function fixtureRepo(base: Tree = { 'docs/superpowers/programs/p/task-1.md': entry(10003) }, head: Tree = {}): string {
  const root = mkTmp('ccrc-next-dev-');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  const commit = (tree: Tree) => {
    for (const [file, text] of Object.entries(tree)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
      'commit', '-q', '--allow-empty', '-m', 'x');
  };
  git('init', '-q', '-b', 'main');
  commit(base);
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  if (Object.keys(head).length) commit(head);
  return root;
}
/** Moves `origin/main` one commit ahead of where it is, adding `tree`; HEAD stays where it was. */
function onMainAhead(root: string, tree: Tree): void {
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  const back = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  git('checkout', '-q', '-b', 'main-ahead', 'origin/main');
  for (const [file, text] of Object.entries(tree)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  git('add', '-A');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'main moves on');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  git('checkout', '-q', back);
  git('branch', '-q', '-D', 'main-ahead');
}
/** The collision guard's own composition (`deviation-refs.test.ts`), run on a fixture repo against `origin/main`. */
function guard(root: string): { n: number; files: string[] }[] {
  return selfAssignedCollisions(readDefinitionFilesAt(root, 'HEAD'), readDefinitionFilesAt(root, 'origin/main'),
    changedDefinitionPaths(root, 'origin/main'));
}
function entry(n: number): string { return `## Deviations found\n\n- **${D(n)}** \u2014 a deviation.\n`; }
const run = (cwd: string, ...args: string[]) => spawnSync(TSX, [SCRIPT, ...args], { cwd, encoding: 'utf8' });

describe('nextDeviationNumbers', () => {
  it('starts at the era when everything is below it', () => {
    expect(nextDeviationNumbers([d(8966)], 3)).toEqual([10000, 10001, 10002]);
  });
  it('continues past the highest at or above the era', () => {
    expect(nextDeviationNumbers([d(8966), d(10004), d(10001)], 2)).toEqual([10005, 10006]);
  });
  it('an empty tree starts at the era', () => {
    expect(nextDeviationNumbers([], 1)).toEqual([10000]);
  });
  it('refuses a count outside 1..LEDGER_ALLOC_MAX', () => {
    for (const bad of [0, -1, 1.5, LEDGER_ALLOC_MAX + 1]) expect(() => nextDeviationNumbers([], bad)).toThrow(RangeError);
  });
});

describe('resolveLedgerBase (the one base resolver: the helper and the guard)', () => {
  const withUpstream = (): string => {
    const root = fixtureRepo();
    execFileSync('git', ['update-ref', 'refs/remotes/upstream/main', 'HEAD'], { cwd: root });
    return root;
  };
  it('picks upstream/main over origin/main when both resolve (a fork)', () => {
    expect(resolveLedgerBase(withUpstream(), undefined)).toBe('upstream/main');
  });
  it('picks origin/main when there is no upstream', () => {
    expect(resolveLedgerBase(fixtureRepo(), undefined)).toBe('origin/main');
  });
  it('the env var wins over both', () => {
    expect(resolveLedgerBase(withUpstream(), 'HEAD')).toBe('HEAD');
  });
  it('an env var that does not resolve falls through, never guessed', () => {
    expect(resolveLedgerBase(withUpstream(), 'no-such-ref')).toBe('upstream/main');
  });
  it('a stale upstream/main (a strict ancestor of origin/main) yields to origin/main, which holds all it does', () => {
    const root = withUpstream();
    onMainAhead(root, { 'docs/superpowers/plans/later.md': entry(10004) });
    expect(resolveLedgerBase(root, undefined)).toBe('origin/main');
    expect(staleLedgerBase(root, 'origin/main')).toBeNull();
    expect(staleLedgerBase(root, 'upstream/main')).toEqual({ anchor: 'origin/main', behind: 1 });
  });
  it('none resolves: null, with no local-main fallback (D-' + '2732)', () => {
    const root = fixtureRepo();
    execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: root });
    expect(resolveLedgerBase(root, undefined)).toBeNull();
  });
});

describe('the guard\'s two git reads', () => {
  const git = (root: string, ...a: string[]): string => execFileSync('git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...a],
    { cwd: root, encoding: 'utf8' }).trim();
  const A = 'docs/superpowers/plans/old-name.md';
  const B = 'docs/superpowers/plans/new-name.md';
  it('changedDefinitionPaths lists a rename as both paths, so the old path counts as changed', () => {
    const body = '# A plan\n\n' + 'A line of the plan that the move keeps.\n'.repeat(20) + entry(10020);
    const root = fixtureRepo({ [A]: body });
    git(root, 'mv', A, B);
    writeFileSync(path.join(root, B), body.replace('a deviation', 'reworded on the move'));
    expect(git(root, 'diff', '--name-status', '--find-renames', 'HEAD'), 'git must see a rename here').toMatch(/^R\d+/);
    git(root, 'commit', '-qam', 'rename');
    expect([...changedDefinitionPaths(root, 'origin/main')].sort()).toEqual([B, A].sort());
  });
  it('changedDefinitionPaths lists a deleted path, measured from the merge base after main moved on', () => {
    const root = fixtureRepo({ [A]: entry(10020) });
    git(root, 'rm', '-q', A);
    git(root, 'commit', '-qm', 'delete');
    const later = git(root, 'commit-tree', 'origin/main^{tree}', '-p', 'origin/main', '-m', 'main moves on');
    git(root, 'update-ref', 'refs/remotes/origin/main', later);
    expect([...changedDefinitionPaths(root, 'origin/main')]).toEqual([A]);
  });
  it('changedDefinitionPaths diffs from the merge base: a file main added after the fork is not listed, and its clash reds', () => {
    const mine = 'docs/superpowers/plans/mine.md';
    const theirs = 'docs/superpowers/plans/theirs.md';
    const root = fixtureRepo(undefined, { [mine]: `- **${D(10020)}** \u2014 mine.\n` });
    onMainAhead(root, { [theirs]: `- **${D(10020)}** \u2014 theirs.\n` });
    expect([...changedDefinitionPaths(root, 'origin/main')]).toEqual([mine]);
    expect(guard(root)).toEqual([{ n: 10020, files: [mine, theirs] }]);
  });
  it('staleLedgerBase: a fork whose own origin/main diverged is measured against upstream/main, and is not stale', () => {
    const root = fixtureRepo();
    const up = git(root, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'upstream moves on');
    git(root, 'update-ref', 'refs/remotes/upstream/main', up);
    const fork = git(root, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'the fork commits to its own main');
    git(root, 'update-ref', 'refs/remotes/origin/main', fork);
    expect(resolveLedgerBase(root, undefined)).toBe('upstream/main');
    expect(staleLedgerBase(root, 'upstream/main')).toBeNull();
  });
  it('staleLedgerBase: an explicit base behind the resolver\'s own answer is stale, and says by how much', () => {
    const root = fixtureRepo();
    const old = git(root, 'rev-parse', 'HEAD');
    const up = git(root, 'commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'upstream moves on');
    git(root, 'update-ref', 'refs/remotes/upstream/main', up);
    expect(staleLedgerBase(root, old)).toEqual({ anchor: 'upstream/main', behind: 1 });
    expect(staleLedgerBase(root, 'upstream/main')).toBeNull();
  });
});

describe('next-deviation CLI', () => {
  it('measures upstream/main by itself on a fork, and --ref still overrides', () => {
    const root = fixtureRepo();
    execFileSync('git', ['update-ref', 'refs/remotes/upstream/main', 'HEAD'], { cwd: root });
    expect(run(root).stderr).toMatch(/measured upstream\/main at \w+/);
    expect(run(root, '--ref', 'origin/main').stderr).toMatch(/measured origin\/main at \w+/);
  });
  it('a stale upstream/main behind origin/main: measures origin/main, so a number main already holds is not handed out', () => {
    const root = fixtureRepo();
    execFileSync('git', ['update-ref', 'refs/remotes/upstream/main', 'HEAD'], { cwd: root });
    onMainAhead(root, { 'docs/superpowers/plans/later.md': entry(10004) });
    const r = run(root);
    expect(r.status).toBe(0);
    expect(r.stderr).toMatch(/measured origin\/main at \w+/);
    expect(r.stdout).toBe(`${D(10005)}\n`);
  });
  it('exits 2 when no base resolves, naming both remotes', () => {
    const root = fixtureRepo();
    execFileSync('git', ['update-ref', '-d', 'refs/remotes/origin/main'], { cwd: root });
    const r = run(root);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('upstream main');
    expect(r.stdout).toBe('');
  });
  it('prints the numbers for a fixture repo and names the ref it measured', () => {
    const r = run(fixtureRepo(), '2', '--ref', 'origin/main');
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${D(10004)}\n${D(10005)}\n`);
    expect(r.stderr).toMatch(/measured origin\/main at \w+ and HEAD at \w+/);
  });
  it('counts what HEAD defines and the base does not (a stacked or unmerged branch)', () => {
    const r = run(fixtureRepo({ 'docs/superpowers/plans/a.md': entry(10002) },
      { 'docs/superpowers/plans/b.md': entry(10003) }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${D(10004)}\n`);
  });
  it('counts what the base defines and HEAD does not (main moved on)', () => {
    const root = fixtureRepo({ 'docs/superpowers/plans/a.md': entry(10002) });
    execFileSync('git', ['checkout', '-q', '-b', 'old', 'HEAD'], { cwd: root });
    writeFileSync(path.join(root, 'docs/superpowers/plans/a.md'), entry(10009));
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false',
      'commit', '-qam', 'y'], { cwd: root });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', 'HEAD'], { cwd: root });
    execFileSync('git', ['checkout', '-q', 'main'], { cwd: root });
    expect(run(root).stdout).toBe(`${D(10010)}\n`);
  });
  it('reads exactly the three definition directories', () => {
    expect([...DEFINITION_DIRS]).toEqual(
      ['docs/superpowers/plans/', 'docs/superpowers/programs/', 'docs/superpowers/specs/']);
  });
  for (const dir of DEFINITION_DIRS) {
    it(`reads a definition in ${dir}, and ignores non-.md files and other directories`, () => {
      const root = fixtureRepo({
        [`${dir}x/note.md`]: entry(10006),
        [`${dir}x/note.txt`]: entry(10050),
        'docs/superpowers/other/note.md': entry(10060),
      });
      expect(run(root).stdout).toBe(`${D(10007)}\n`);
      const files = readDefinitionFilesAt(root, 'HEAD');
      expect(files.map((f) => f.path)).toEqual([`${dir}x/note.md`]);
      expect(files[0]!.text).toBe(entry(10006));
    });
  }
  it('reads multi-byte text through the batch reader intact', () => {
    const text = `# \u00e9t\u00e9 \u2014 \u{1F600}\n` + entry(10001);
    const root = fixtureRepo({ 'docs/superpowers/specs/a.md': text, 'docs/superpowers/specs/b.md': entry(10002) });
    expect(readDefinitionFilesAt(root, 'HEAD')).toEqual([
      { path: 'docs/superpowers/specs/a.md', text },
      { path: 'docs/superpowers/specs/b.md', text: entry(10002) },
    ]);
  });
  it('exits 2 and names --ref when the ref does not resolve, with git\'s own cause', () => {
    const r = run(fixtureRepo(), '--ref', 'nope');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--ref');
    expect(r.stderr).toContain('git fetch');
    expect(r.stderr).toMatch(/fatal: /);
    expect(r.stdout).toBe('');
  });
  it('exits 2 on a bad count, with nothing on stdout', () => {
    const r = run(fixtureRepo(), '0');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('count must be');
    expect(r.stdout).toBe('');
  });
  it('exits 2 on an unknown flag, with nothing on stdout', () => {
    const r = run(fixtureRepo(), '--bogus');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('bad argument --bogus');
    expect(r.stdout).toBe('');
  });
});
