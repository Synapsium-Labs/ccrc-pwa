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
import * as reach from '../../.github/ci/reach.mjs';
import { skipsTests, scopeOf, prScope, fastRun, QUEUE_ONLY, FOREIGN, alwaysRunPwaTests } from '../../.github/ci/reach.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REACH = path.join(ROOT, '.github', 'ci', 'reach.mjs');

// TRANSITIONAL (2026-11-02). The queue's browser skip (the owner's ruling of 2026-11-02) lands in three pull
// requests, because a pull request that changes a rules file (.github/**, CLAUDE.md) may change nothing else: first
// these pins and the census, while reach.mjs has no queue arm; then the rules-only pull request (reach.mjs, ci.yml,
// CLAUDE.md); then a pull request that deletes every PRE-SKIP arm below and `queueSkip` with it. Until then each case
// accepts exactly one of the two WHOLE shapes and never a mix: reach.mjs's `queueScope` and QUEUE_SKIPPABLE, and docs/
// foreign to `browser`, all three or none of them.
const queueSkip = typeof (reach as Record<string, unknown>)['queueScope'] === 'function';
const queueScope = (pkg: string, changed: string[]): string =>
  ((reach as Record<string, unknown>)['queueScope'] as (p: string, c: string[]) => string)(pkg, changed);

describe('skipsTests: a package skips its tests only when EVERY changed file is foreign to it', () => {
  it('agent: a change only under pwa/ or ui/ skips; one under agent/, shared/, server/ or the root runs', () => {
    expect(skipsTests('agent', ['pwa/src/a.ts', 'ui/src/b.tsx'])).toBe(true);
    expect(skipsTests('agent', ['pwa/src/a.ts', 'agent/src/c.ts'])).toBe(false);
    expect(skipsTests('agent', ['shared/x.ts'])).toBe(false);
    expect(skipsTests('agent', ['server/test/git-env.setup.mjs'])).toBe(false); // agent's vitest setup file
    expect(skipsTests('agent', ['install.sh'])).toBe(false);
  });

  it('pwa and browser: a change only under agent/, server/, ccd/ or deploy/ skips; shared/, ui/ and the root run', () => {
    for (const pkg of ['pwa', 'browser']) {
      expect(skipsTests(pkg, ['agent/src/a.ts', 'server/src/b.ts', 'ccd/ccd', 'deploy/x.sh'])).toBe(true);
      // what the pwa tests read out of server/ still reaches them (the census pins the list)
      expect(skipsTests(pkg, ['server/src/laneSchedule.ts'])).toBe(false);
      expect(skipsTests(pkg, ['server/test/fixtures/panes/ask-user-question-real.txt'])).toBe(false);
      expect(skipsTests(pkg, ['agent/src/a.ts', 'server/test/fixtures/panes/x.txt'])).toBe(false);
      expect(skipsTests(pkg, ['shared/docs.ts'])).toBe(false);
      expect(skipsTests(pkg, ['ui/src/a.tsx'])).toBe(false);
      expect(skipsTests(pkg, ['README.md'])).toBe(false);
    }
  });

  it('docs/ reaches the pwa suite, which renders it; the browser tests read nothing under it (owner ruling 2026-11-02)', () => {
    expect(skipsTests('pwa', ['server/src/b.ts', 'docs/superpowers/specs/x.md'])).toBe(false);
    expect(skipsTests('pwa', ['docs/superpowers/specs/x.md'])).toBe(false);
    expect(FOREIGN.pwa).not.toContain('docs/');
    if (!queueSkip) {
      // PRE-SKIP arm (transitional): docs/ reaches every pwa-side package, as on main before the ruling.
      expect(FOREIGN.browser).not.toContain('docs/');
      expect(skipsTests('browser', ['server/src/b.ts', 'docs/superpowers/specs/x.md'])).toBe(false);
      return;
    }
    expect(FOREIGN.browser).toContain('docs/');
    expect(skipsTests('browser', ['server/src/b.ts', 'docs/superpowers/specs/x.md'])).toBe(true);
    expect(skipsTests('browser', ['docs/superpowers/specs/x.md', 'docs/design/a.png'])).toBe(true);
    // a directory, not a name prefix
    expect(skipsTests('browser', ['docs-extra/a.md'])).toBe(false);
    expect(skipsTests('browser', ['docs/a.md', 'pwa/src/a.ts'])).toBe(false);
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

// The queue's browser skip (the owner's ruling of 2026-11-02, reversing 2026-10-25's "the queue runs every test" for
// the browser shards only): in a merge-queue run the browser leg asks reach.mjs of the group's whole change and skips
// its tests when no file in it can reach them. Every other package runs every test in the queue.
describe('the queue\'s browser skip (owner ruling 2026-11-02): a merge-queue group that cannot reach the browser tests skips them', () => {
  const run = (args: string[], changed: string[] | null): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-queue-'));
    const list = path.join(dir, 'changed.txt');
    const out = path.join(dir, 'output.txt');
    if (changed !== null) writeFileSync(list, changed.join('\n') + '\n');
    writeFileSync(out, '');
    execFileSync('node', [REACH, ...args, '--changed-file', list], { env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8' });
    return readFileSync(out, 'utf8');
  };
  const skipOf = (text: string): string => /^skip=(.*)$/m.exec(text)?.[1] ?? '';

  it('queueScope: skip only for the browser leg, and only when every file of the group is foreign to it', () => {
    if (!queueSkip) {
      // PRE-SKIP arm (transitional): reach.mjs has no queue arm at all.
      expect(Object.keys(reach)).not.toContain('QUEUE_SKIPPABLE');
      return;
    }
    expect((reach as Record<string, unknown>)['QUEUE_SKIPPABLE']).toEqual(['browser']);
    expect(queueScope('browser', ['docs/superpowers/plans/x.md'])).toBe('skip');
    expect(queueScope('browser', ['docs/a.md', 'docs/design/b.png', 'server/src/c.ts'])).toBe('skip');
    for (const reaching of ['pwa/src/a.ts', 'ui/src/b.tsx', 'shared/api.ts', 'README.md', 'server/test/fixtures/panes/x.txt', '.github/workflows/ci.yml']) {
      expect(queueScope('browser', ['docs/a.md', reaching]), reaching).toBe('all');
    }
    // fails safe: an empty change, an unknown package, and every other package run every test
    expect(queueScope('browser', [])).toBe('all');
    expect(queueScope('browser', ['', '  '])).toBe('all');
    expect(queueScope('nope', ['docs/a.md'])).toBe('all');
    expect(queueScope('pwa', ['docs/a.md'])).toBe('all');
    expect(queueScope('pwa', ['agent/src/a.ts'])).toBe('all'); // a pull request would skip it; the queue never does
    expect(queueScope('agent', ['pwa/src/a.ts'])).toBe('all');
  });

  it('the CLI: a docs-only merge_group skips the browser tests; a group that reaches them, or any other package, runs them', () => {
    const docsOnly = run(['--pkg', 'browser', '--event', 'merge_group'], ['docs/superpowers/plans/x.md']);
    if (!queueSkip) {
      // PRE-SKIP arm (transitional): the queue runs every test.
      expect(skipOf(docsOnly)).toBe('false');
      return;
    }
    expect(docsOnly).toMatch(/^skip=true$/m);
    expect(docsOnly).toMatch(/^scope=skip$/m);
    expect(skipOf(run(['--pkg', 'browser', '--event', 'merge_group'], ['docs/a.md', 'pwa/src/a.ts']))).toBe('false');
    expect(skipOf(run(['--pkg', 'pwa', '--event', 'merge_group'], ['docs/a.md']))).toBe('false');
    expect(skipOf(run(['--pkg', 'agent', '--event', 'merge_group'], ['pwa/src/a.ts']))).toBe('false');
    // a label never reaches a queue run, and asks for more tests, never fewer
    expect(skipOf(run(['--pkg', 'browser', '--event', 'merge_group', '--full-label', 'false'], ['docs/a.md']))).toBe('true');
    // only the queue and a pull request skip: the same docs-only change elsewhere runs the browser tests
    for (const event of ['schedule', 'workflow_dispatch', 'workflow_call', 'push', '']) {
      expect(skipOf(run(['--pkg', 'browser', '--event', event], ['docs/a.md'])), event).toBe('false');
    }
  });

  it('the CLI fails safe in the queue: a group it cannot diff runs the browser tests', () => {
    const missing = run(['--pkg', 'browser', '--event', 'merge_group'], null);
    expect(skipOf(missing)).toBe('false');
    if (queueSkip) expect(missing).toMatch(/^scope=all$/m);
  });

  it('diffs the group from --base (the queue\'s base sha) to HEAD, every commit in it', () => {
    const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, {
      cwd, encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
    const commit = (repo: string, file: string, msg: string): void => {
      mkdirSync(path.join(repo, path.dirname(file)), { recursive: true });
      writeFileSync(path.join(repo, file), `${msg}\n`);
      git(repo, 'add', '-A');
      git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg);
    };
    const group = (files: string[]): string => {
      const repo = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-queue-git-'));
      git(repo, 'init', '-q', '-b', 'main');
      commit(repo, 'pwa/src/a.ts', 'base');
      const base = git(repo, 'rev-parse', 'HEAD').trim();
      files.forEach((f, i) => commit(repo, f, `entry ${i}`)); // one commit per queued pull request
      const out = path.join(repo, '..', `out-${path.basename(repo)}.txt`);
      writeFileSync(out, '');
      execFileSync('node', [REACH, '--pkg', 'browser', '--event', 'merge_group', '--base', base], {
        cwd: repo, env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8',
      });
      return skipOf(readFileSync(out, 'utf8'));
    };
    expect(group(['docs/superpowers/plans/x.md', 'docs/superpowers/specs/y.md'])).toBe(queueSkip ? 'true' : 'false');
    // an earlier entry of the same group that reaches the browser tests runs them for the whole group
    expect(group(['pwa/src/b.ts', 'docs/superpowers/plans/x.md'])).toBe('false');
  });
});

// A DOCS-ONLY CHANGE (D-7868, the operator's direction of 2026-11-03) runs only the checks that can see it. One
// predicate, `docsOnly`: a non-empty change whose every file is under docs/ and is no infrastructure file. In the
// merge queue, `queueScope` answers per leg from QUEUE_DOCS_ONLY: the server tests a pull request runs (`selected`),
// no node floor or agent tests (`skip`), the pwa suite whole (`all`). On a pull request, docs/ is foreign to the agent
// tests and to `pwa-build` (the pwa typecheck, build and Storybook), so they skip through `skipsTests`.
describe('a docs-only change (D-7868): one predicate, and the queue and pull-request arms that use it', () => {
  const { docsOnly, QUEUE_DOCS_ONLY } = reach as unknown as { docsOnly: (c: string[]) => boolean; QUEUE_DOCS_ONLY: Record<string, string> };

  it('docsOnly: true only for a non-empty change whose every file is a document under docs/', () => {
    expect(docsOnly(['docs/superpowers/specs/x.md'])).toBe(true);
    expect(docsOnly(['docs/superpowers/specs/x.md', 'docs/superpowers/plans/y.md', 'docs/design/z.png'])).toBe(true);
    expect(docsOnly([' docs/a.md ', ''])).toBe(true); // blank lines from a diff are no file
    // a root file is NOT docs-only: about 40 server suites read them
    for (const root of ['README.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'SECURITY.md']) expect(docsOnly([root]), root).toBe(false);
    // docs/ plus any other file is mixed, whatever the other file is
    for (const other of ['pwa/src/a.ts', 'server/src/b.ts', 'README.md', '.github/workflows/ci.yml', 'agent/src/c.ts', 'ccd/ccd', 'shared/api.ts']) {
      expect(docsOnly(['docs/a.md', other]), other).toBe(false);
    }
    // a path that only starts like docs/ is not under it
    expect(docsOnly(['docsite/a.md'])).toBe(false);
    expect(docsOnly(['pwa/src/docs/a.ts'])).toBe(false);
    // infrastructure under docs/ is infrastructure (select-tests.mjs infraTrigger)
    for (const infra of ['docs/x/package.json', 'docs/x/package-lock.json', 'docs/tsconfig.json', 'docs/vitest.config.ts', 'docs/.npmrc']) {
      expect(docsOnly([infra]), infra).toBe(false);
      expect(docsOnly(['docs/a.md', infra]), infra).toBe(false);
    }
    // an empty change, or one with no file in it, is never docs-only: everything runs
    expect(docsOnly([])).toBe(false);
    expect(docsOnly(['', '  '])).toBe(false);
  });

  it('queueScope: a docs-only group selects the server tests and skips the node floor and agent tests; pwa runs whole', () => {
    expect(QUEUE_DOCS_ONLY).toEqual({ server: 'selected', 'node-floor': 'skip', agent: 'skip' });
    const docs = ['docs/superpowers/plans/x.md', 'docs/superpowers/specs/y.md'];
    expect(queueScope('server', docs)).toBe('selected');
    expect(queueScope('node-floor', docs)).toBe('skip');
    expect(queueScope('agent', docs)).toBe('skip');
    expect(queueScope('pwa', docs), 'the pwa suite renders docs/').toBe('all');
    expect(queueScope('browser', docs), "#2177's browser skip is kept").toBe('skip');
    expect(queueScope('pwa-build', docs), 'the queue runs the pwa build checks whatever changed').toBe('all');
    expect(queueScope('nope', docs)).toBe('all');
  });

  it('queueScope: a mixed group, a root file, infrastructure under docs/ and an empty group run as today (all)', () => {
    for (const changed of [['docs/a.md', 'pwa/src/a.ts'], ['docs/a.md', 'server/src/b.ts'], ['README.md'], ['docs/a.md', 'CLAUDE.md'],
      ['docs/a.md', '.github/workflows/ci.yml'], ['docs/x/package.json'], [], ['', ' ']]) {
      for (const pkg of ['server', 'node-floor', 'agent', 'pwa']) expect(queueScope(pkg, changed), `${pkg} ${JSON.stringify(changed)}`).toBe('all');
    }
  });

  it('a pull request: docs/ is foreign to the agent tests and to pwa-build, never to pwa; pwa-build claims nothing wider', () => {
    expect(FOREIGN.agent).toContain('docs/');
    expect(FOREIGN['pwa-build']).toEqual(['docs/']);
    for (const pkg of ['agent', 'pwa-build']) {
      expect(prScope(pkg, ['docs/superpowers/specs/x.md']), pkg).toBe('skip');
      for (const reaching of ['README.md', 'CLAUDE.md', 'shared/api.ts', '.github/workflows/ci.yml', 'docs/x/package.json']) {
        expect(prScope(pkg, ['docs/a.md', reaching]), `${pkg} ${reaching}`).toBe('all');
      }
      expect(prScope(pkg, [])).toBe('all');
    }
    for (const reaching of ['pwa/src/a.ts', 'ui/src/b.tsx', 'pwa/vite.config.ts', 'ui/.storybook/main.ts', 'server/src/c.ts']) {
      expect(prScope('pwa-build', ['docs/a.md', reaching]), reaching).toBe('all');
    }
    expect(prScope('pwa', ['docs/a.md'])).toBe('all');
  });

  const ask = (args: string[], changed: string[] | null): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-docs-'));
    const list = path.join(dir, 'changed.txt');
    const out = path.join(dir, 'output.txt');
    if (changed !== null) writeFileSync(list, changed.join('\n') + '\n');
    writeFileSync(out, '');
    execFileSync('node', [REACH, ...args, '--changed-file', list], { env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8' });
    return readFileSync(out, 'utf8');
  };

  it('--ask fast: a docs-only merge-queue group is fast (the pull request\'s server selection); a mixed or undiffable one is not', () => {
    expect(ask(['--ask', 'fast', '--event', 'merge_group'], ['docs/superpowers/plans/x.md'])).toBe('fast=true\n');
    expect(ask(['--ask', 'fast', '--event', 'merge_group'], ['docs/a.md', 'pwa/src/a.ts'])).toBe('fast=false\n');
    expect(ask(['--ask', 'fast', '--event', 'merge_group'], ['README.md'])).toBe('fast=false\n');
    expect(ask(['--ask', 'fast', '--event', 'merge_group'], [])).toBe('fast=false\n');
    expect(ask(['--ask', 'fast', '--event', 'merge_group'], null)).toBe('fast=false\n');
    // the pull request's answer for the same change is unchanged: an ordinary change is fast
    expect(ask(['--ask', 'fast', '--event', 'pull_request', '--full-label', 'false'], ['docs/a.md'])).toBe('fast=true\n');
    expect(ask(['--ask', 'fast', '--event', 'schedule'], ['docs/a.md'])).toBe('fast=false\n');
  });

  it('the CLI: a docs-only merge-queue group skips the agent tests; a mixed group, or pwa, runs them', () => {
    const skipOf = (t: string): string => /^skip=(.*)$/m.exec(t)?.[1] ?? '';
    const docs = ask(['--pkg', 'agent', '--event', 'merge_group'], ['docs/superpowers/plans/x.md']);
    expect(docs).toMatch(/^skip=true$/m);
    expect(docs).toMatch(/^scope=skip$/m);
    expect(skipOf(ask(['--pkg', 'agent', '--event', 'merge_group'], ['docs/a.md', 'agent/src/a.ts']))).toBe('false');
    expect(skipOf(ask(['--pkg', 'agent', '--event', 'merge_group'], ['docs/a.md', 'pwa/src/a.ts']))).toBe('false');
    expect(skipOf(ask(['--pkg', 'agent', '--event', 'merge_group'], null))).toBe('false');
    const pwa = ask(['--pkg', 'pwa', '--event', 'merge_group'], ['docs/a.md']);
    expect(skipOf(pwa)).toBe('false');
    expect(pwa).toMatch(/^scope=all$/m);
    // the queue never hands a leg `selected`: that is the server's, carried by select.mjs and fast-plan
    expect(ask(['--pkg', 'server', '--event', 'merge_group'], ['docs/a.md'])).toMatch(/^scope=all$/m);
    // a docs-only pull request skips the pwa build checks; the full-ci label or a train/ branch runs them
    expect(skipOf(ask(['--pkg', 'pwa-build', '--event', 'pull_request', '--full-label', 'false'], ['docs/a.md']))).toBe('true');
    expect(skipOf(ask(['--pkg', 'pwa-build', '--event', 'pull_request', '--full-label', 'true'], ['docs/a.md']))).toBe('false');
    expect(skipOf(ask(['--pkg', 'agent', '--event', 'pull_request', '--full-label', 'true'], ['docs/a.md']))).toBe('false');
  });

  it('--ask fast diffs the group from --base (the queue\'s base sha) to HEAD, every entry of it', () => {
    const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, {
      cwd, encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    });
    const fastOf = (files: string[]): string => {
      const repo = mkdtempSync(path.join(tmpdir(), 'ccrc-reach-docs-git-'));
      git(repo, 'init', '-q', '-b', 'main');
      const commit = (file: string, msg: string): void => {
        mkdirSync(path.join(repo, path.dirname(file)), { recursive: true });
        writeFileSync(path.join(repo, file), `${msg}\n`);
        git(repo, 'add', '-A');
        git(repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg);
      };
      commit('pwa/src/a.ts', 'base');
      const base = git(repo, 'rev-parse', 'HEAD').trim();
      files.forEach((f, i) => commit(f, `entry ${i}`));
      const out = path.join(repo, '..', `out-${path.basename(repo)}.txt`);
      writeFileSync(out, '');
      execFileSync('node', [REACH, '--ask', 'fast', '--event', 'merge_group', '--base', base], {
        cwd: repo, env: { ...process.env, GITHUB_OUTPUT: out }, encoding: 'utf8',
      });
      return readFileSync(out, 'utf8');
    };
    expect(fastOf(['docs/superpowers/plans/x.md', 'docs/superpowers/specs/y.md'])).toBe('fast=true\n');
    expect(fastOf(['README.md', 'docs/superpowers/plans/x.md'])).toBe('fast=false\n');
  });
});
