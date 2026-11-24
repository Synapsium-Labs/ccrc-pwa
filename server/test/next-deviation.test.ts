import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_ALLOC_MAX, nextDeviationNumbers } from '../src/coord/ledger.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';
import { DEFINITION_DIRS, readDefinitionFilesAt } from '../scripts/next-deviation.js';

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

describe('next-deviation CLI', () => {
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
