import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_ALLOC_MAX, nextDeviationNumbers } from '../src/coord/ledger.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(() => removeTmpFixtures());

const d = (n: number, file = 'docs/superpowers/plans/a.md') => ({ file, n });
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSX = path.resolve(HERE, '../node_modules/.bin/tsx');
const SCRIPT = path.resolve(HERE, '../scripts/next-deviation.ts');
const D = (n: number) => 'D-' + n; // built, so no scanner reads a deviation ref here

function fixtureRepo(): string {
  const root = mkTmp('ccrc-next-dev-');
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  mkdirSync(path.join(root, 'docs/superpowers/programs/p'), { recursive: true });
  writeFileSync(path.join(root, 'docs/superpowers/programs/p/task-1.md'),
    `## Deviations found\n\n- **${D(10003)}** — a deviation.\n`);
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'x');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return root;
}
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
    expect(r.stderr).toContain('origin/main at');
  });
  it('exits 2 and names --ref when the ref does not resolve', () => {
    const r = run(fixtureRepo(), '--ref', 'nope');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--ref');
    expect(r.stderr).toContain('git fetch origin main');
    expect(r.stdout).toBe('');
  });
});
