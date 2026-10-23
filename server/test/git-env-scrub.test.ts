// The runner's own environment must never carry a git variable that redirects a fixture repository to ANOTHER one.
// A server run once inherited GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE from its parent; every fixture `git init`,
// `git config` and `git checkout -B` in a mkdtemp directory then wrote into the repository GIT_DIR named, not the
// fixture. `git-env.setup.mjs` removes those variables (see `scrub-git-env.mjs`) from the vitest main process and from
// every worker. Here a bare-`node` child plays the runner: it is handed a THROWAWAY outer repository through
// GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE and runs a representative fixture sequence, with and without the scrub.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isGitRedirectVar, scrubGitEnv } from './scrub-git-env.mjs';
import { GIT_LOCAL_ENV_FLOOR, gitLocalEnvVars } from './gitEnvStrip.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SETUP_URL = pathToFileURL(path.join(here, 'git-env.setup.mjs')).href;

/** The fixture sequence the real suites run, as a child that optionally loads the setup module first. */
const CHILD = `
import { execFileSync } from 'node:child_process';
const [mode, fixture] = process.argv.slice(2);
if (mode === 'scrubbed') await import(${JSON.stringify(SETUP_URL)});
const git = (...a) => execFileSync('git', a, { cwd: fixture, stdio: 'pipe' });
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'fixture@example.invalid');
git('config', 'user.name', 'fixture');
git('commit', '--allow-empty', '-q', '-m', 'fixture commit');
git('checkout', '-q', '-B', 'fixture-branch');
git('update-ref', 'refs/remotes/origin/main', 'HEAD');
`;

let root: string;
let outer: string;
let fixture: string;
let childFile: string;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '', HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });

/** Everything the incident changed in the outer repository: config bytes, HEAD, every ref. */
const snapshot = (): string => [
  readFileSync(path.join(outer, '.git', 'config'), 'utf8'),
  readFileSync(path.join(outer, '.git', 'HEAD'), 'utf8'),
  git(outer, 'for-each-ref'),
].join('\n--\n');

const runChild = (mode: 'scrubbed' | 'unscrubbed'): void => {
  execFileSync(process.execPath, [childFile, mode, fixture], {
    stdio: 'pipe',
    env: {
      PATH: process.env['PATH'] ?? '', HOME: root, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_DIR: path.join(outer, '.git'), GIT_WORK_TREE: outer, GIT_INDEX_FILE: path.join(outer, '.git', 'index'),
      GIT_NAMESPACE: 'outer-ns',
    },
  });
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'git-env-scrub-'));
  outer = path.join(root, 'outer');
  fixture = path.join(root, 'fixture');
  childFile = path.join(root, 'child.mjs');
  writeFileSync(childFile, CHILD);
  for (const d of [outer, fixture]) execFileSync('mkdir', ['-p', d]);
  git(outer, 'init', '-q', '-b', 'main');
  git(outer, 'config', 'user.email', 'outer@example.invalid');
  git(outer, 'config', 'user.name', 'outer');
  git(outer, 'commit', '--allow-empty', '-q', '-m', 'outer commit');
});

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('git-env.setup.mjs', () => {
  it('CONTROL: without the scrub, the sequence writes into the repository GIT_DIR names', () => {
    const before = snapshot();
    runChild('unscrubbed');
    expect(snapshot(), 'the incident did not reproduce, so the next row proves nothing').not.toBe(before);
  });

  it('with the scrub, the outer repository is untouched and the fixture repository gets the commits', () => {
    const before = snapshot();
    runChild('scrubbed');
    expect(snapshot()).toBe(before);
    expect(git(outer, 'config', '--get', 'core.bare').trim()).toBe('false');
    expect(git(fixture, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('fixture-branch');
    expect(git(fixture, 'log', '--format=%s').trim()).toBe('fixture commit');
    expect(git(fixture, 'config', '--get', 'user.email').trim()).toBe('fixture@example.invalid');
    expect(git(fixture, 'rev-parse', 'refs/remotes/origin/main')).toBe(git(fixture, 'rev-parse', 'HEAD'));
  });
});

describe('scrubGitEnv', () => {
  it('removes git\'s local list, GIT_NAMESPACE and the numbered config pairs, and keeps the rest', () => {
    const env: NodeJS.ProcessEnv = {
      GIT_DIR: 'a', GIT_WORK_TREE: 'a', GIT_INDEX_FILE: 'a', GIT_COMMON_DIR: 'a', GIT_NAMESPACE: 'a', GIT_PREFIX: 'a',
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'k', GIT_CONFIG_VALUE_0: 'v',
      GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CEILING_DIRECTORIES: '/x',
      GIT_DISCOVERY_ACROSS_FILESYSTEM: '1', GIT_AUTHOR_DATE: 'd', PATH: '/bin',
    };
    scrubGitEnv(env);
    expect(Object.keys(env).sort()).toEqual([
      'GIT_AUTHOR_DATE', 'GIT_CEILING_DIRECTORIES', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_DISCOVERY_ACROSS_FILESYSTEM', 'PATH',
    ]);
  });

  it('covers every name this box\'s git prints for --local-env-vars', () => {
    for (const name of [...GIT_LOCAL_ENV_FLOOR, ...gitLocalEnvVars()]) {
      expect(isGitRedirectVar(name), `${name} survives the scrub`).toBe(true);
    }
  });
});

describe('the vitest wiring', () => {
  const strip = (f: string): string => readFileSync(path.join(here, '..', '..', f), 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

  it.each(['server', 'agent'])('%s/vitest.config.ts scrubs in the main process first and in every worker', (pkg) => {
    const code = strip(`${pkg}/vitest.config.ts`);
    const list = (key: string): string[] =>
      [...(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(code)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(list('globalSetup')[0], 'the scrub is not the first globalSetup').toMatch(/git-env\.setup\.mjs$/);
    expect(list('setupFiles')[0], 'the scrub is not the first setupFile').toMatch(/git-env\.setup\.mjs$/);
  });

  it('a server worker has none of the redirecting variables, whatever the parent exported', () => {
    for (const k of Object.keys(process.env)) expect(isGitRedirectVar(k), `${k} reached this worker`).toBe(false);
  });
});
