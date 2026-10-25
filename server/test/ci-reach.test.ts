/**
 * The light pull-request rule for the agent suite, the pwa shards and the
 * browser leg (operator ruling 2026-10-25): a pull request runs a package's
 * TESTS only when its change can reach them, and the merge queue, the daily
 * run and a dispatch always run them. The typechecks, the build and the
 * required check names are not this rule's business — they run either way.
 * `.github/ci/reach.mjs` is the one place the rule is written.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipsTests, FOREIGN } from '../../.github/ci/reach.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REACH = path.join(ROOT, '.github', 'ci', 'reach.mjs');

describe('skipsTests: a package skips its tests only when EVERY changed file is foreign to it', () => {
  it('agent: a change only under pwa/ or ui/ skips; one under agent/, shared/, server/ or the root runs', () => {
    expect(skipsTests('agent', ['pwa/src/a.ts', 'ui/src/b.tsx'])).toBe(true);
    expect(skipsTests('agent', ['pwa/src/a.ts', 'agent/src/c.ts'])).toBe(false);
    expect(skipsTests('agent', ['shared/x.ts'])).toBe(false);
    expect(skipsTests('agent', ['server/test/git-env.setup.mjs'])).toBe(false); // agent's vitest setup file
    expect(skipsTests('agent', ['install.sh'])).toBe(false);
  });

  it('pwa and browser: a change only under agent/, server/, ccd/ or deploy/ skips; docs/, shared/, ui/ and the root run', () => {
    for (const pkg of ['pwa', 'browser']) {
      expect(skipsTests(pkg, ['agent/src/a.ts', 'server/src/b.ts', 'ccd/ccd', 'deploy/x.sh'])).toBe(true);
      expect(skipsTests(pkg, ['server/src/b.ts', 'docs/superpowers/specs/x.md'])).toBe(false); // pwa tests render docs
      expect(skipsTests(pkg, ['shared/docs.ts'])).toBe(false);
      expect(skipsTests(pkg, ['ui/src/a.tsx'])).toBe(false);
      expect(skipsTests(pkg, ['README.md'])).toBe(false);
    }
  });

  it('fails safe: an empty change, an unknown package, or a path outside every list runs the tests', () => {
    expect(skipsTests('agent', [])).toBe(false);
    expect(skipsTests('nope', ['pwa/a.ts'])).toBe(false);
    expect(skipsTests('agent', ['.github/workflows/ci.yml'])).toBe(false);
  });

  it('a foreign prefix is a directory, not a name prefix: pwa-extra/ is not pwa/', () => {
    expect(skipsTests('agent', ['pwa-extra/a.ts'])).toBe(false);
  });

  it('no package treats the other packages\' shared inputs as foreign', () => {
    for (const [pkg, list] of Object.entries(FOREIGN)) {
      expect(list).not.toContain('shared/');
      expect(list).not.toContain('.github/');
      expect(list).not.toContain(`${pkg}/`);
    }
  });
});

describe('reach.mjs CLI', () => {
  const run = (args: string[], changed: string[], env: Record<string, string> = {}): { skip: string; out: string } => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-'));
    const list = path.join(dir, 'changed.txt');
    const out = path.join(dir, 'output.txt');
    writeFileSync(list, changed.join('\n') + '\n');
    writeFileSync(out, '');
    const stdout = execFileSync('node', [REACH, ...args, '--changed-file', list], {
      env: { ...process.env, GITHUB_OUTPUT: out, ...env }, encoding: 'utf8',
    });
    return { skip: /^skip=(.*)$/m.exec(readFileSync(out, 'utf8'))?.[1] ?? '', out: stdout };
  };

  it('a pull request that reaches nothing skips; the same change on a merge_group, a push or a dispatch does not', () => {
    const changed = ['pwa/src/a.ts'];
    expect(run(['--pkg', 'agent', '--event', 'pull_request'], changed).skip).toBe('true');
    for (const event of ['merge_group', 'schedule', 'workflow_dispatch', 'workflow_call', 'push', '']) {
      expect(run(['--pkg', 'agent', '--event', event], changed).skip, event).toBe('false');
    }
  });

  it('the full-ci label forces the tests on a pull request', () => {
    expect(run(['--pkg', 'agent', '--event', 'pull_request', '--full-label', 'true'], ['pwa/src/a.ts']).skip).toBe('false');
  });

  it('a missing change list fails safe: the tests run', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-'));
    const out = path.join(dir, 'output.txt');
    writeFileSync(out, '');
    execFileSync('node', [REACH, '--pkg', 'agent', '--event', 'pull_request', '--changed-file', path.join(dir, 'absent.txt')], {
      env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8',
    });
    expect(readFileSync(out, 'utf8')).toContain('skip=false');
  });

  describe('a moved file counts at BOTH paths (git diff --no-renames)', () => {
    const git = (cwd: string, ...a: string[]): void => {
      execFileSync('git', a, {
        cwd, stdio: 'ignore',
        env: { PATH: process.env.PATH ?? '', HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
      });
    };
    const moved = (from: string, to: string, pkg: string): string => {
      const repo = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-git-'));
      const out = path.join(repo, '..', `out-${path.basename(repo)}.txt`);
      writeFileSync(out, '');
      mkdirSync(path.join(repo, path.dirname(from)), { recursive: true });
      writeFileSync(path.join(repo, from), 'export const x = 1;\n'.repeat(20));
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'add', '-A');
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'base');
      git(repo, 'checkout', '-q', '-b', 'pr');
      mkdirSync(path.join(repo, path.dirname(to)), { recursive: true });
      git(repo, 'mv', from, to);
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'move');
      execFileSync('node', [REACH, '--pkg', pkg, '--event', 'pull_request', '--base', 'main'], {
        cwd: repo, env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8',
      });
      return /^skip=(.*)$/m.exec(readFileSync(out, 'utf8'))?.[1] ?? '';
    };

    it('shared/ moved into server/ still runs the pwa and browser tests', () => {
      expect(moved('shared/x.ts', 'server/x.ts', 'pwa')).toBe('false');
      expect(moved('shared/x.ts', 'server/x.ts', 'browser')).toBe('false');
    });

    it('shared/ moved into ui/ still runs the agent tests', () => {
      expect(moved('shared/x.ts', 'ui/x.ts', 'agent')).toBe('false');
    });
  });
});
