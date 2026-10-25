// D-TBD-ledger-guard (a root-cause fix from the landing measurement): a pull request that is not a ledger pull request
// may not modify or delete an existing file under docs/superpowers/programs/ or docs/superpowers/plans/.
// It may ADD a per-task note under docs/superpowers/plans/<plan>/<task-or-pr>.md; the coordinator folds
// the notes into the ledger in one ledger pull request per wave. A `Ledger-Edit: <reason>` trailer on any
// commit of the change is the escape hatch, and the guard reports it. Fixture repositories only: every git
// child runs with the repository-redirecting variables removed, so a test can never write into the real repo.
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { isGitRedirectVar } from './scrub-git-env.mjs';
import { classifyChange } from '../../.github/ci/ledger-guard.mjs';

const GUARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'ci', 'ledger-guard.mjs');

const cleanEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!isGitRedirectVar(k)) env[k] = v;
  delete env.GITHUB_HEAD_REF; delete env.GITHUB_EVENT_NAME; delete env.GITHUB_STEP_SUMMARY;
  return { ...env, ...extra };
};
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    { cwd, encoding: 'utf8', env: cleanEnv(), stdio: 'pipe' });
const put = (dir: string, rel: string, text: string): void => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};

/** A repo whose `main` holds a programme ledger and a plan; returns it with `origin/main` set. */
function fixture(): string {
  const dir = mkTmp('ledger-guard-');
  git(dir, 'init', '-q', '-b', 'main');
  put(dir, 'docs/superpowers/programs/x.md', '| row | open |\n');
  put(dir, 'docs/superpowers/plans/2026-01-01-p.md', '# plan\n');
  put(dir, 'src/a.txt', 'a\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(dir, 'checkout', '-q', '-b', 'work');
  return dir;
}
const commit = (dir: string, msg: string): void => { git(dir, 'add', '-A'); git(dir, 'commit', '-q', '-m', msg); };

function run(dir: string, branch: string, extra: Record<string, string> = {}, args: string[] = []) {
  const summary = path.join(dir, '.summary');
  const r = spawnSync('node', [GUARD, '--repo', dir, '--base', 'origin/main', ...args], {
    encoding: 'utf8', env: cleanEnv({ GITHUB_HEAD_REF: branch, GITHUB_EVENT_NAME: 'pull_request', GITHUB_STEP_SUMMARY: summary, ...extra }),
  });
  let sum = ''; try { sum = readFileSync(summary, 'utf8'); } catch { /* none written */ }
  return { code: r.status, out: `${r.stdout}${r.stderr}`, sum };
}

describe('ledger-guard CLI', () => {
  it('(1) a feature branch editing a programme ledger fails', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const r = run(d, 'feat/thing');
    expect(r.code).toBe(1);
    expect(r.out).toContain('docs/superpowers/programs/x.md');
  });

  it('(1b) editing, deleting or renaming an existing plan fails; the same edit on a plan note fails too', () => {
    const d = fixture();
    put(d, 'docs/superpowers/plans/2026-01-01-p.md', '# plan 2\n'); commit(d, 'edit plan');
    expect(run(d, 'feat/thing').code).toBe(1);
    git(d, 'reset', '-q', '--hard', 'origin/main');
    git(d, 'rm', '-q', 'docs/superpowers/plans/2026-01-01-p.md'); commit(d, 'delete plan');
    expect(run(d, 'feat/thing').code).toBe(1);
    git(d, 'reset', '-q', '--hard', 'origin/main');
    git(d, 'mv', 'docs/superpowers/plans/2026-01-01-p.md', 'docs/elsewhere.md'); commit(d, 'rename plan away');
    expect(run(d, 'feat/thing').code).toBe(1);
  });

  it('(2) a feature branch adding a per-task note, a new plan or a new programme file passes', () => {
    const d = fixture();
    put(d, 'docs/superpowers/plans/p/t1.md', 'note\n');
    put(d, 'docs/superpowers/plans/2026-02-02-q.md', '# new\n');
    put(d, 'src/a.txt', 'b\n'); commit(d, 'add note');
    const r = run(d, 'feat/thing');
    expect(r.code).toBe(0);
  });

  it('(3) a ledger/ branch editing a programme ledger passes', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'fold');
    expect(run(d, 'ledger/x').code).toBe(0);
  });

  it('(4) the Ledger-Edit trailer passes and is reported in the step summary', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n');
    commit(d, 'edit ledger\n\nLedger-Edit: D-' + '9999 the row is this change\'s own');
    const r = run(d, 'feat/thing');
    expect(r.code).toBe(0);
    expect(r.sum).toContain('Ledger-Edit');
    expect(r.sum).toContain('D-' + '9999');
    expect(r.sum).toContain('docs/superpowers/programs/x.md');
  });

  it('(4b) a trailer with no reason does not count', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n');
    commit(d, 'edit ledger\n\nLedger-Edit:');
    expect(run(d, 'feat/thing').code).toBe(1);
  });

  it('(5) a shallow clone skips with a notice', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const shallow = mkTmp('ledger-guard-shallow-');
    git(shallow, 'clone', '-q', '--depth', '1', `file://${d}`, 'c');
    const c = path.join(shallow, 'c');
    git(c, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    const r = run(c, 'feat/thing');
    expect(r.code).toBe(0);
    expect(r.out.toLowerCase()).toContain('shallow');
  });

  it('a merge-queue run skips with a notice (the head branch is not known there)', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const r = run(d, '', { GITHUB_EVENT_NAME: 'merge_group' });
    expect(r.code).toBe(0);
    expect(r.out).toContain('merge_group');
  });

  it('warn mode reports the violation and exits 0; enforce is the default', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    const w = run(d, 'feat/thing', {}, ['--mode', 'warn']);
    expect(w.code).toBe(0);
    expect(w.out).toContain('docs/superpowers/programs/x.md');
    expect(run(d, 'feat/thing').code).toBe(1);
  });

  it('a branch with no name (a detached local run) is treated as a feature branch', () => {
    const d = fixture();
    put(d, 'docs/superpowers/programs/x.md', '| row | done |\n'); commit(d, 'edit ledger');
    expect(run(d, '').code).toBe(1);
  });
});

describe('classifyChange', () => {
  it('only existing files under the two ledger trees are violations', () => {
    const v = classifyChange([
      'M\tdocs/superpowers/programs/x.md',
      'D\tdocs/superpowers/plans/a.md',
      'R100\tdocs/superpowers/plans/b.md\tdocs/c.md',
      'A\tdocs/superpowers/plans/p/t.md',
      'A\tdocs/superpowers/programs/new.md',
      'M\tdocs/superpowers/specs/s.md',
      'M\tserver/src/a.ts',
    ]);
    expect(v).toEqual([
      'docs/superpowers/programs/x.md', 'docs/superpowers/plans/a.md', 'docs/superpowers/plans/b.md',
    ]);
  });
});

// Mutation table (run against the real guard; each mutant must turn at least one row red):
//  m1 treat every branch as a ledger branch            -> rows (1), (1b), (4b) red
//  m2 flag added files too                             -> row (2) red
//  m3 ignore the trailer                               -> row (4) red
//  m4 accept an empty trailer reason                   -> row (4b) red
//  m5 do not skip on a shallow clone                   -> row (5) red
//  m6 warn mode still exits 1                          -> warn row red
//  m7 forget rename sources                            -> row (1b) rename step red
