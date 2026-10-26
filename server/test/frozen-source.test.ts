import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { hasCommit, readAtSha } from './frozenSource.js';

// The frozen compaction-card documents are measured at their freeze commit, so
// an edit to a cited source file after that commit cannot move their debt.
describe('frozenSource reads a file at a commit, not the working tree', () => {
  const scrub = (): NodeJS.ProcessEnv => {
    const e = { ...process.env };
    for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY']) delete e[k];
    return e;
  };
  const git = (dir: string, ...a: string[]): string => execFileSync('git',
    ['-C', dir, '-c', 'user.email=f@example.invalid', '-c', 'user.name=f', ...a],
    { encoding: 'utf8', env: scrub() }).trim();

  const fixture = (): { dir: string; sha: string } => {
    const dir = mkTmp('frozen-src-');
    git(dir, 'init', '-q');
    fs.writeFileSync(path.join(dir, 'a.sh'), 'one\ntwo\nthree\n');
    git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'freeze');
    const sha = git(dir, 'rev-parse', 'HEAD');
    // After the freeze: a line is inserted at the top, committed and left dirty.
    fs.writeFileSync(path.join(dir, 'a.sh'), 'new\none\ntwo\nthree\n');
    git(dir, 'commit', '-qam', 'later');
    fs.writeFileSync(path.join(dir, 'a.sh'), 'dirty\nnew\none\ntwo\nthree\n');
    return { dir, sha };
  };

  it('returns the lines the file had at the sha, with later commits and dirty edits invisible', () => {
    const { dir, sha } = fixture();
    expect(readAtSha(dir, sha, 'a.sh')).toEqual(['one', 'two', 'three', '']);
  });

  it('is null for a path the commit does not hold, and hasCommit tells a held sha from a missing one', () => {
    const { dir, sha } = fixture();
    expect(readAtSha(dir, sha, 'nope.sh')).toBeNull();
    expect(hasCommit(dir, sha)).toBe(true);
    expect(hasCommit(dir, '0'.repeat(40))).toBe(false);
  });

  it('is not redirected by an inherited GIT_DIR', () => {
    const { dir, sha } = fixture();
    const prev = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(dir, 'elsewhere');
    try { expect(readAtSha(dir, sha, 'a.sh')?.[0]).toBe('one'); }
    finally { if (prev === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = prev; }
  });
});
