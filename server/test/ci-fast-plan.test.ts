/**
 * The server tests a FAST pull request runs (operator ruling 2026-10-28), `.github/ci/fast-plan.mjs`: the tests
 * vitest relates to the change, the map's selection for the changed paths vitest cannot follow (select's
 * `untraced`), every guard suite that scans the whole tree or the diff, and the session-hook suites when the hook's
 * inputs changed, packed by measured duration. Any failure answers the fallback select handed in, never nothing.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fastSelection, relatedFromVitestList, guardTests, parseUntraced, GUARD_TESTS, PIN_MAP_CARRIED, TREE_READER, SESSION_HOOK_TRIGGERS } from '../../.github/ci/fast-plan.mjs';
import { liveTestFiles, vitestFollows } from '../../.github/ci/select-tests.mjs';
import { untracedOutput } from '../../.github/ci/select.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLAN = path.join(ROOT, '.github', 'ci', 'fast-plan.mjs');

const LIVE = [
  'server/test/a.test.ts',
  'server/test/b.test.ts',
  'server/test/census-w5/redactors.test.ts',
  'server/test/consolidation-census.test.ts',
  'server/test/rings/totality.test.ts',
  'server/test/coord-policy-rings.test.ts',
  'server/test/single-definition/vocabularies.test.ts',
  'server/test/single-definition-pin.test.ts',
  'server/test/deviation-refs.test.ts',
  'server/test/growth-check.test.ts',
  'server/test/ownership.test.ts',
  'server/test/ccd-contexts.test.ts',
  'server/test/dtbd.test.ts',
  'server/test/typecheck-tests.test.ts',
  'server/test/session-hook.test.ts',
  'server/test/session-hook-account-deny.test.ts',
];
const GUARDS = LIVE.filter((f) => !/\/(a|b|session-hook[^/]*)\.test\.ts$/.test(f)).sort();

describe('fastSelection: the related tests, every guard suite, and the hook suites when the hook can be reached', () => {
  it('a change no test relates to still runs every guard suite, and nothing else', () => {
    const sel = fastSelection({ live: LIVE, related: [], guards: GUARDS, changed: ['docs/x.md'] });
    expect(sel.files).toEqual(GUARDS);
    expect(sel.related).toBe(0);
    expect(sel.guards).toBe(GUARDS.length);
    expect(sel.hook).toBe(false);
  });

  it('adds the related tests that are live, once, sorted', () => {
    const sel = fastSelection({ live: LIVE, related: ['server/test/b.test.ts', 'server/test/gone.test.ts', 'server/test/dtbd.test.ts'], guards: GUARDS, changed: ['server/src/x.ts'] });
    expect(sel.files).toEqual([...GUARDS, 'server/test/b.test.ts'].sort());
    expect(sel.related).toBe(2);
  });

  it('runs every session-hook suite when ccd/ccd, ccd/session-hook.sh or shared/api.ts changed, and only then', () => {
    expect(SESSION_HOOK_TRIGGERS).toEqual(['ccd/ccd', 'ccd/session-hook.sh', 'shared/api.ts']);
    for (const trigger of SESSION_HOOK_TRIGGERS) {
      const sel = fastSelection({ live: LIVE, related: [], guards: GUARDS, changed: ['docs/x.md', trigger] });
      expect(sel.hook, trigger).toBe(true);
      expect(sel.files, trigger).toContain('server/test/session-hook.test.ts');
      expect(sel.files, trigger).toContain('server/test/session-hook-account-deny.test.ts');
    }
    expect(fastSelection({ live: LIVE, related: [], guards: GUARDS, changed: ['ccd/ccd-lib.sh'] }).hook).toBe(false);
  });

  it('adds the map\'s untraced selection that is live, and counts it apart from vitest\'s', () => {
    const sel = fastSelection({ live: LIVE, related: ['server/test/a.test.ts'], untraced: ['server/test/a.test.ts', 'server/test/b.test.ts', 'server/test/gone.test.ts'], guards: GUARDS, changed: ['ccd/ccd-account-auth'] });
    expect(sel.files).toEqual([...GUARDS, 'server/test/a.test.ts', 'server/test/b.test.ts'].sort());
    expect(sel.related).toBe(1);
    expect(sel.untraced).toBe(2);
  });
});

describe('the guard suites: patterns, less the map-carried pins, plus every test that reads the tree or the diff itself', () => {
  const live = liveTestFiles(ROOT);
  const guards = guardTests(live, (f) => readFileSync(path.join(ROOT, f), 'utf8'));

  it('every guard family the ruling names matches a live test in this tree', () => {
    for (const family of ['census', 'single-definition', 'deviation-refs', 'growth-check', 'ownership', 'rings/', 'ccd-contexts',
      'consolidation-census', 'dtbd', 'typecheck-tests', 'oss-metadata', '-pin.test.ts']) {
      expect(guards.some((f) => f.includes(family)), family).toBe(true);
    }
    expect(guards.some((f) => f.includes('session-hook')), 'a session-hook suite is conditional, never a guard').toBe(false);
  });

  // The suites a review found missing (2026-10-28): each scans `git ls-files`, the diff or named files, so vitest
  // can never relate it, and a red there first showing in the merge queue costs a whole group re-run.
  it('carries topology-clean, oss-metadata, gitignore-secrets and consolidation-path-guard', () => {
    for (const f of ['topology-clean', 'oss-metadata', 'gitignore-secrets', 'consolidation-path-guard']) {
      expect(guards, f).toContain(`server/test/${f}.test.ts`);
    }
  });

  it('TREE_READER is what finds the tree readers: a direct git ls-files / diff / merge-base, never a fixture helper', () => {
    for (const f of ['topology-clean', 'gitignore-secrets', 'consolidation-path-guard', 'source-bytes', 'citations']) {
      expect(TREE_READER.test(readFileSync(path.join(ROOT, 'server', 'test', `${f}.test.ts`), 'utf8')), f).toBe(true);
    }
    expect(TREE_READER.test("execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })")).toBe(true);
    expect(TREE_READER.test("spawnSync('git', ['-C', REPO, 'ls-files'])")).toBe(true);
    expect(TREE_READER.test("execSync('git ls-files -z', { cwd: ROOT })")).toBe(true);
    expect(TREE_READER.test("execFileSync('git', ['merge-base', 'origin/main', 'HEAD'])")).toBe(true);
    expect(TREE_READER.test("h.git(wt, 'ls-files', '-v')")).toBe(false);
    expect(TREE_READER.test("execFileSync('git', ['log', '-1'])")).toBe(false);
  });

  it('every pin suite is a guard or named in PIN_MAP_CARRIED, and every PIN_MAP_CARRIED entry is a live ccd-script pin', () => {
    const pins = live.filter((f) => /-pin\.test\.ts$/.test(f));
    expect(pins.length).toBeGreaterThan(0);
    for (const f of pins) expect(guards.includes(f) || PIN_MAP_CARRIED.includes(f), f).toBe(true);
    for (const f of PIN_MAP_CARRIED) {
      expect(live, `${f} is gone: drop it from PIN_MAP_CARRIED`).toContain(f);
      expect(guards, `${f} is map-carried, not a guard`).not.toContain(f);
      expect(readFileSync(path.join(ROOT, f), 'utf8'), `${f} must pin a ccd script`).toMatch(/\bccd\b/);
    }
  });

  it('an unreadable test file counts as a guard (the safe direction)', () => {
    expect(guardTests(['server/test/x.test.ts'], () => { throw new Error('EACCES'); })).toEqual(['server/test/x.test.ts']);
    expect(guardTests(['server/test/x.test.ts'], () => 'import { x } from "../src/x.js";')).toEqual([]);
    expect(GUARD_TESTS.length).toBeGreaterThan(0);
  });
});

describe('the untraced half: what the map selects for the paths vitest cannot follow', () => {
  it('vitestFollows is the JS/TS modules of server/ and shared/ only', () => {
    for (const p of ['server/src/x.ts', 'server/test/x.test.ts', 'shared/api.ts', 'shared/x.mjs', 'server/src/x.js']) expect(vitestFollows(p), p).toBe(true);
    for (const p of ['ccd/ccd', 'ccd/ccd-account-auth', 'ccd/x.py', 'server/test/fixtures/x.json', 'server/src/x.sql', 'pwa/src/x.ts', 'docs/x.md', 'deploy/x.sh']) {
      expect(vitestFollows(p), p).toBe(false);
    }
  });

  it('select\'s output: the list as JSON, `full` when nothing bounds it, empty off a pull request', () => {
    expect(untracedOutput({ isPr: false, untraced: ['a'], changedPaths: null })).toBe('');
    expect(untracedOutput({ isPr: true, untraced: ['server/test/a.test.ts'], changedPaths: null })).toBe('["server/test/a.test.ts"]');
    expect(untracedOutput({ isPr: true, untraced: 'full', changedPaths: ['ccd/ccd'] })).toBe('full');
    // No usable map: an all-TypeScript change needs none; anything else, or an unreadable diff, is unbounded.
    expect(untracedOutput({ isPr: true, untraced: undefined, changedPaths: ['server/src/x.ts'] })).toBe('[]');
    expect(untracedOutput({ isPr: true, untraced: undefined, changedPaths: ['server/src/x.ts', 'ccd/ccd'] })).toBe('full');
    expect(untracedOutput({ isPr: true, untraced: undefined, changedPaths: null })).toBe('full');
  });

  it('parseUntraced reads the list, and refuses `full`, nothing, or another shape', () => {
    expect(parseUntraced('["server/test/a.test.ts"]\n')).toEqual(['server/test/a.test.ts']);
    expect(parseUntraced('[]')).toEqual([]);
    expect(() => parseUntraced('full')).toThrow(/cannot bound/);
    expect(() => parseUntraced('')).toThrow(/no untraced/);
    expect(() => parseUntraced('{"a":1}')).toThrow(/not an array/);
  });
});

describe('relatedFromVitestList: a `vitest list --filesOnly --json` report, repo-relative', () => {
  it('turns absolute paths into repo-relative ones', () => {
    expect(relatedFromVitestList([{ file: path.join(ROOT, 'server', 'test', 'a.test.ts') }], ROOT)).toEqual(['server/test/a.test.ts']);
  });

  it('refuses a report that is not that shape, or a path outside the repository', () => {
    expect(() => relatedFromVitestList({ files: [] }, ROOT)).toThrow(/not an array/);
    expect(() => relatedFromVitestList([{ name: 'x' }], ROOT)).toThrow(/no file/);
    expect(() => relatedFromVitestList([{ file: '/elsewhere/x.test.ts' }], ROOT)).toThrow(/outside the repository/);
  });
});

describe('fast-plan.mjs: the CLI plans the shards, and falls back rather than answer nothing', () => {
  const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, {
    cwd, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', HOME: cwd, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  });
  const repo = (): string => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-fast-plan-'));
    for (const f of LIVE) {
      mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
      writeFileSync(path.join(dir, f), '');
    }
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'base');
    mkdirSync(path.join(dir, 'shared'), { recursive: true });
    writeFileSync(path.join(dir, 'shared', 'api.ts'), 'export {};\n');
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'change');
    return dir;
  };
  const run = (dir: string, related: string | null, extra: string[] = [], untraced = '[]'): { status: number | null, out: Record<string, string> } => {
    const out = path.join(dir, '..', `out-${path.basename(dir)}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(out, '');
    const untracedFile = path.join(dir, '..', `untraced-${path.basename(dir)}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(untracedFile, untraced);
    const args = [PLAN, '--repo', dir, '--base', 'HEAD~1', '--related', related ?? path.join(dir, 'missing.json'), '--untraced', untracedFile, ...extra];
    const r = spawnSync('node', args, { cwd: dir, env: { ...process.env, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8' });
    const outputs = Object.fromEntries(readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    return { status: r.status, out: outputs };
  };

  it('an empty report plans the guards and the hook suites the shared/api.ts change reaches', () => {
    const dir = repo();
    const rel = path.join(dir, '..', `rel-${path.basename(dir)}.json`);
    writeFileSync(rel, '');
    const r = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9']);
    expect(r.status).toBe(0);
    expect(r.out.fallback).toBe('');
    expect(r.out.count).toBe(String(GUARDS.length + 2));
    const files = (JSON.parse(r.out.server_matrix) as { include: Array<{ files: string }> }).include.flatMap((s) => s.files.split(' '));
    expect(files.sort()).toEqual([...GUARDS, 'server/test/session-hook.test.ts', 'server/test/session-hook-account-deny.test.ts'].map((f) => f.replace(/^server\//, '')).sort());
  });

  it('a related report adds its tests', () => {
    const dir = repo();
    const rel = path.join(dir, '..', `rel-${path.basename(dir)}.json`);
    writeFileSync(rel, JSON.stringify([{ file: path.join(dir, 'server', 'test', 'a.test.ts') }]));
    const r = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9']);
    expect(r.out.count).toBe(String(GUARDS.length + 3));
    expect(r.out.server_matrix).toContain('test/a.test.ts');
  });

  it('an untraced list adds its tests; `full` answers the fallback', () => {
    const dir = repo();
    const rel = path.join(dir, '..', `rel-${path.basename(dir)}.json`);
    writeFileSync(rel, '[]');
    const r = run(dir, rel, ['--fallback-matrix', '{"include":[]}', '--fallback-count', '9'], '["server/test/b.test.ts"]');
    expect(r.out.count).toBe(String(GUARDS.length + 3));
    expect(r.out.server_matrix).toContain('test/b.test.ts');
    const f = run(dir, rel, ['--fallback-matrix', '{"include":[{"shard":1}]}', '--fallback-count', '9'], 'full');
    expect(f.status).toBe(0);
    expect(f.out.count).toBe('9');
    expect(f.out.fallback).toMatch(/cannot bound/);
  });

  it('no report (vitest list failed) answers the fallback, with the reason', () => {
    const dir = repo();
    const r = run(dir, null, ['--fallback-matrix', '{"include":[{"shard":1}]}', '--fallback-count', '9']);
    expect(r.status).toBe(0);
    expect(r.out.server_matrix).toBe('{"include":[{"shard":1}]}');
    expect(r.out.count).toBe('9');
    expect(r.out.fallback).not.toBe('');
  });

  it('a failure with no fallback handed in fails the step: never a green over nothing', () => {
    const dir = repo();
    const r = run(dir, null);
    expect(r.status).not.toBe(0);
    expect(r.out.server_matrix).toBeUndefined();
  });
});
