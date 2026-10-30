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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipsTests, scopeOf, prScope, fastRun, QUEUE_ONLY, FOREIGN, alwaysRunPwaTests } from '../../.github/ci/reach.mjs';

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
      // what the pwa tests read out of server/ still reaches them (the census pins the list)
      expect(skipsTests(pkg, ['server/src/laneSchedule.ts'])).toBe(false);
      expect(skipsTests(pkg, ['server/test/fixtures/panes/ask-user-question-real.txt'])).toBe(false);
      expect(skipsTests(pkg, ['agent/src/a.ts', 'server/test/fixtures/panes/x.txt'])).toBe(false);
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

describe('scopeOf: the pwa shards run only what vitest can relate to the change, else everything', () => {
  it('a change vitest can follow through imports is `changed`; foreign files are ignored', () => {
    expect(scopeOf('pwa', ['pwa/src/a.ts', 'ui/src/b.tsx', 'shared/api.ts', 'pwa/test/x.test.tsx'])).toBe('changed');
    expect(scopeOf('pwa', ['pwa/src/a.ts', 'server/src/b.ts', 'agent/src/c.ts'])).toBe('changed');
  });

  it('a change reached by a file read (docs, fixtures, package files, configs, the root) is `all`', () => {
    for (const f of ['docs/superpowers/specs/x.md', 'server/test/fixtures/panes/a.txt', 'server/src/laneSchedule.ts', 'pwa/package.json',
      'pwa/vite.config.ts', 'pwa/test/fixtures/x.json', 'pwa/public/a.png', 'README.md']) {
      expect(scopeOf('pwa', ['pwa/src/a.ts', f]), f).toBe('all');
    }
  });

  it('a change under pwa/src or ui/src that is not .ts/.tsx (CSS, JSON, an asset) is `all`: the tests that read it from disk are not reached by imports', () => {
    for (const f of ['pwa/src/index.css', 'pwa/src/styles/skin-a.css', 'ui/src/tokens.css', 'pwa/src/data/words.json', 'ui/src/icons/x.svg', 'pwa/src/fonts/a.woff2']) {
      expect(scopeOf('pwa', [f]), f).toBe('all');
      expect(scopeOf('pwa', ['pwa/src/a.ts', f]), f).toBe('all');
    }
    // and only those: a .ts or .tsx source change stays `changed`
    expect(scopeOf('pwa', ['pwa/src/a.tsx', 'ui/src/b.ts'])).toBe('changed');
  });

  it('a non-TypeScript change under shared/ is `all` too', () => {
    expect(scopeOf('pwa', ['shared/fixtures/a.json'])).toBe('all');
    expect(scopeOf('pwa', ['shared/base-url.mjs'])).toBe('changed');
  });

  it('skip stays skip, and the other packages are never `changed`', () => {
    expect(scopeOf('pwa', ['agent/src/a.ts'])).toBe('skip');
    expect(scopeOf('agent', ['shared/x.ts'])).toBe('all');
    expect(scopeOf('browser', ['pwa/src/a.ts'])).toBe('all');
    expect(scopeOf('pwa', [])).toBe('all');
  });
});

describe('alwaysRunPwaTests: the pwa tests that read source from disk run on every `changed` pull request', () => {
  const always = alwaysRunPwaTests(ROOT);

  it('a CSS-only change runs css-vars.test.ts (the change is `all`, and css-vars reads the CSS with fs)', () => {
    expect(scopeOf('pwa', ['pwa/src/index.css'])).toBe('all');
    expect(always).toContain('test/css-vars.test.ts');
  });

  it('holds the suites that scan pwa/src and ui/src with node:fs, however they reach fs (directly or through a helper)', () => {
    for (const f of ['css-vars', 'contrast', 'design-system-boundary', 'skin-boundary', 'ui-package-boundary', 'quiet-control',
      'utility-pairs', 'hover-states', 'fleet-css', 'refusal-literal-ratchet', 'focus-ring']) {
      expect(always, f).toContain(`test/${f}.test.ts`);
    }
  });

  it('holds every census and guard suite', () => {
    const names = readdirSync(path.join(ROOT, 'pwa', 'test')).filter((f) => /-(census|guard)\.test\.tsx?$/.test(f));
    expect(names.length).toBeGreaterThan(0);
    for (const f of names) expect(always, f).toContain(`test/${f}`);
  });

  // An independent census: a test that CALLS an fs read, however it got fs, must be in the set, so a new way of
  // reaching node:fs that the import scan misses goes red here instead of silently skipping on a pull request.
  it('census: every pwa test file that calls an fs read is in the set', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.test\.tsx?$/.test(e.name) ? [p] : [];
    });
    const pwa = path.join(ROOT, 'pwa');
    const missing = [path.join(pwa, 'test'), path.join(pwa, 'src')].flatMap(walk)
      .filter((p) => /\b(readFileSync|readdirSync|readFile|readdir|existsSync|statSync|lstatSync|opendirSync|globSync|createReadStream)\s*\(/.test(readFileSync(p, 'utf8')))
      .map((p) => path.relative(pwa, p).split(path.sep).join('/'))
      .filter((f) => !always.includes(f));
    expect(missing).toEqual([]);
  });

  it('every path is a plain pwa-relative test path the shell can pass as one argument', () => {
    expect(always.length).toBeGreaterThan(50);
    for (const f of always) expect(f).toMatch(/^(test|src)\/[A-Za-z0-9._/-]+\.test\.tsx?$/);
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

  it('a `changed` pwa scope writes the always-run list to the output', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-'));
    const list = path.join(dir, 'changed.txt');
    const out = path.join(dir, 'output.txt');
    writeFileSync(list, 'pwa/src/a.ts\n');
    writeFileSync(out, '');
    execFileSync('node', [REACH, '--pkg', 'pwa', '--event', 'pull_request', '--changed-file', list], {
      cwd: ROOT, env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8',
    });
    const text = readFileSync(out, 'utf8');
    expect(text).toMatch(/^scope=changed$/m);
    const always = /^always=(.*)$/m.exec(text)?.[1]?.split(' ') ?? [];
    expect(always).toContain('test/css-vars.test.ts');
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

    it('shared/ moved into server/ still runs the pwa tests; the browser leg is the merge queue\'s on a fast pull request', () => {
      expect(moved('shared/x.ts', 'server/x.ts', 'pwa')).toBe('false');
      // reach.mjs QUEUE_ONLY (operator ruling 2026-10-28): an ordinary pull request leaves the browser suite to the queue.
      expect(moved('shared/x.ts', 'server/x.ts', 'browser')).toBe('true');
    });

    it('shared/ moved into ui/ still runs the agent tests', () => {
      expect(moved('shared/x.ts', 'ui/x.ts', 'agent')).toBe('false');
    });
  });
});

describe('the fast run (operator ruling 2026-10-28): an ordinary pull request runs the fast checks only', () => {
  it('fastRun: an ordinary change is fast; shared infrastructure, or no change at all, is the full run', () => {
    expect(fastRun(['pwa/src/a.ts', 'server/src/b.ts', 'ccd/ccd', 'docs/x.md']).fast).toBe(true);
    for (const infra of ['.github/workflows/ci.yml', 'server/package-lock.json', 'pwa/package.json', 'server/vitest.config.ts',
      'agent/tsconfig.json', '.gitattributes', '.npmrc', 'server/scripts/fix-node-pty-helper.mjs']) {
      const answer = fastRun(['pwa/src/a.ts', infra]);
      expect(answer.fast, infra).toBe(false);
      expect(answer.why, infra).toContain(infra);
    }
    expect(fastRun([]).fast).toBe(false);
    expect(fastRun(['', '  ']).fast).toBe(false);
  });

  it('prScope: the browser leg skips on a fast change and follows scopeOf otherwise; every other package is scopeOf', () => {
    expect(QUEUE_ONLY).toEqual(['browser']);
    expect(prScope('browser', ['pwa/src/a.ts'])).toBe('skip');
    expect(prScope('browser', ['pwa/package.json'])).toBe(scopeOf('browser', ['pwa/package.json']));
    expect(prScope('browser', ['pwa/package.json'])).toBe('all');
    for (const changed of [['pwa/src/a.ts'], ['server/src/b.ts'], ['pwa/src/x.css']]) {
      for (const pkg of ['agent', 'pwa']) expect(prScope(pkg, changed)).toBe(scopeOf(pkg, changed));
    }
  });

  it('--ask fast writes fast=true only for an ordinary pull request without the full-ci label or a train/ branch', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-fast-'));
    const ask = (event: string, fullLabel: string, changed: string): string => {
      const out = path.join(dir, `out-${event}-${fullLabel}-${changed.replace(/\W/g, '_')}.txt`);
      const list = path.join(dir, 'changed.txt');
      writeFileSync(out, '');
      writeFileSync(list, `${changed}\n`);
      execFileSync('node', [REACH, '--ask', 'fast', '--event', event, '--full-label', fullLabel, '--changed-file', list], {
        env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8',
      });
      return readFileSync(out, 'utf8');
    };
    expect(ask('pull_request', 'false', 'pwa/src/a.ts')).toBe('fast=true\n');
    expect(ask('pull_request', 'true', 'pwa/src/a.ts')).toBe('fast=false\n');
    expect(ask('pull_request', 'false', '.github/workflows/ci.yml')).toBe('fast=false\n');
    expect(ask('merge_group', 'false', 'pwa/src/a.ts')).toBe('fast=false\n');
    expect(ask('schedule', 'false', 'pwa/src/a.ts')).toBe('fast=false\n');
  });
});
