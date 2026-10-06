// Child reclamation wave 6, Task 2 (spec §5.6): the reclaim and expire
// suites' ONE strip of git's inherited environment. A runner started under a
// git hook, or by anything that exported GIT_DIR, would hand every
// `...process.env` spread — and every spawn that names no env — another
// repository, and the fixtures would init, commit and reclaim THERE.
// `inheritedEnv()` is process.env minus git's `--local-env-vars` list,
// GIT_NAMESPACE and the GIT_CONFIG_KEY_<n>/VALUE_<n> entries. It is never put
// inside `ghContainedEnv`, whose callers pass git variables on purpose.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { GIT_LOCAL_ENV_FLOOR, gitLocalEnvVars, inheritedEnv } from './gitEnvStrip.js';
import { makeCcdHarness } from './ccdWsHelpers.js';

/** Runs fn with `extra` laid over process.env, and puts process.env back whatever happens. */
const withEnv = <T>(extra: Record<string, string>, fn: () => T): T => {
  const saved = { ...process.env };
  Object.assign(process.env, extra);
  try { return fn(); } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
};

const PLANTED: Record<string, string> = {
  GIT_DIR: '/elsewhere/.git', GIT_WORK_TREE: '/elsewhere', GIT_INDEX_FILE: '/elsewhere/index',
  GIT_CONFIG: '/elsewhere/config', GIT_CONFIG_PARAMETERS: "'core.hookspath'='/elsewhere'", GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/elsewhere', GIT_CONFIG_KEY_7: 'x.y', GIT_CONFIG_VALUE_7: 'z',
  GIT_NAMESPACE: 'elsewhere', GIT_OBJECT_DIRECTORY: '/elsewhere/objects', GIT_NO_REPLACE_OBJECTS: '1',
};
/** Outside the ruled list — kept, so the strip is no wider than spec §5.6 says. */
const KEPT: Record<string, string> = { GIT_AUTHOR_NAME: 'T', GIT_CONFIG_GLOBAL: '/dev/null', CCRC_GIT_ENV_STRIP_KEEP: 'kept' };

describe('inheritedEnv (spec §5.6)', () => {
  it('drops git’s local list, GIT_NAMESPACE and every GIT_CONFIG_KEY_/VALUE_ entry — and nothing else', () => {
    const e = withEnv({ ...PLANTED, ...KEPT }, inheritedEnv);
    expect(Object.keys(e).filter((k) => k in PLANTED).sort(), 'a repository-selecting or config variable survived').toEqual([]);
    expect(Object.fromEntries(Object.keys(KEPT).map((k) => [k, e[k]])), 'a variable outside the list was dropped').toEqual(KEPT);
    expect(e['PATH']).toBe(process.env['PATH']);
  });

  it('drops every name this box’s git prints for `git rev-parse --local-env-vars`, and the 2.43 floor', () => {
    const live = execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8', env: { PATH: process.env['PATH'] ?? '' } })
      .split('\n').filter(Boolean);
    expect(live.length, 'the CONTROL: git answered').toBeGreaterThan(0);
    expect([...gitLocalEnvVars()].sort()).toEqual([...live].sort());
    const names = [...new Set([...live, ...GIT_LOCAL_ENV_FLOOR])];
    const e = withEnv(Object.fromEntries(names.map((n) => [n, 'planted'])), inheritedEnv);
    expect(names.filter((n) => n in e)).toEqual([]);
  });

  it('answers a copy — writing it never writes process.env', () => {
    const e = inheritedEnv();
    e['CCRC_GIT_ENV_STRIP_WRITE'] = '1';
    expect(process.env['CCRC_GIT_ENV_STRIP_WRITE']).toBeUndefined();
  });
});

describe('the harness drops an inherited GIT_DIR (spec §5.6’s pin)', () => {
  it('a GIT_DIR in the runner’s environment reaches neither ccd nor the fixture’s repositories', () => {
    const h = makeCcdHarness('ccrc-git-env-strip-');
    try {
      // The decoy lives inside the fixture HOME: a repository the variables point at, never a real one.
      const decoy = path.join(h.home, 'decoy');
      h.git(h.home, 'init', '-q', '-b', 'main', decoy);
      const decoyGit = path.join(decoy, '.git');
      withEnv({ GIT_DIR: decoyGit, GIT_WORK_TREE: decoy, GIT_CONFIG_PARAMETERS: "'core.hookspath'='/from-parameters'" }, () => {
        expect(h.sh('printf "%s|%s|%s" "${GIT_DIR-unset}" "${GIT_WORK_TREE-unset}" "${GIT_CONFIG_PARAMETERS-unset}"'),
          'what ccd inherits').toBe('unset|unset|unset');
        const main = h.makeRepo('demo');
        expect(h.git(main, 'rev-parse', '--absolute-git-dir'), 'the fixture repository is its own').toBe(path.join(main, '.git'));
        expect(h.git(main, 'log', '--format=%s'), 'its commit landed in it').toBe('init');
      });
      expect(h.git(decoy, 'rev-list', '--all', '--count'), 'the decoy holds no commit').toBe('0');
    } finally { h.cleanup(); }
  }, 60_000);
});

describe('every reclaim and expire suite takes its environment through the strip', () => {
  /** The suites and fixtures spec §5.6 names: the reclaim and expire ccd suites, their fixtures, and the base harness. */
  const SCOPE = /^(ccd-child-reclaim-.*\.test\.ts|ccd-child-tmproot-.*\.test\.ts|ccd-path-users\.test\.ts|ccd-leaf-remove\.test\.ts|ccd-ws-expire-.*\.test\.ts|childReclaim[A-Za-z]*\.ts|pathUsersFixture\.ts|wsExpireFixture\.ts|ccdWsHelpers\.ts)$/;
  // ...and the ccd suites and the fixture that Tasks 4, 5 and 7 add under names
  // those patterns miss: `ccd-path-users`, `pathUsersFixture`, `ccd-leaf-remove`
  // and `ccd-child-tmproot-*`.
  /** A spread or a whole-environment copy: one line shows it. */
  const SPREAD = /\.\.\.process\.env\b|entries\(process\.env\)/;
  /** A git spawn, in any of node's spellings. Each call is read to its MATCHING
   *  paren, so an options object with no `env:` is seen, and so is an argv split
   *  over lines; `env: process.env` is no strip either. */
  const GIT_SPAWN = /\b(?:execFileSync|spawnSync|execFile|spawn)\(\s*[`'"]git[`'"]|\bexecSync\(\s*[`'"]git\b/g;
  const hitsIn = (f: string, src: string): string[] => {
    const hits: string[] = [];
    src.split('\n').forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      if (SPREAD.test(l)) hits.push(`${f}:${i + 1}: ${l.trim()}`);
    });
    for (const m of src.matchAll(GIT_SPAWN)) {
      const at = m.index!;
      if (/^\s*(\/\/|\*)/.test(src.slice(src.lastIndexOf('\n', at) + 1, at))) continue;
      let i = at + m[0].length, d = 1;
      while (d && i < src.length) { const c = src[i++]; d += c === '(' ? 1 : c === ')' ? -1 : 0; }
      const call = src.slice(at, i);
      if (!/\benv\s*:/.test(call) || /\benv\s*:\s*process\.env\b/.test(call)) {
        hits.push(`${f}:${src.slice(0, at).split('\n').length}: ${call.replace(/\s+/g, ' ').slice(0, 120)}`);
      }
    }
    return hits;
  };

  it('SCOPE names every new ccd suite and fixture Tasks 3–11 create — before any of them exists', () => {
    const later = [
      'ccd-child-reclaim-tail-contained.test.ts', 'ccd-path-users.test.ts', 'pathUsersFixture.ts', 'ccd-leaf-remove.test.ts',
      'ccd-child-reclaim-tmproot-wait.test.ts', 'ccd-child-tmproot-witness.test.ts', 'ccd-child-reclaim-gone-branch.test.ts',
      'ccd-child-reclaim-recovery.test.ts', 'ccd-child-reclaim-unmeasured-journal.test.ts', 'ccd-child-reclaim-prelock-journal.test.ts',
    ];
    expect(later.filter((f) => !SCOPE.test(f)), 'a later task’s file the scan would never read').toEqual([]);
  });

  it('CONTROL: the matcher flags each spelling, over lines too, and passes a stripped spawn and a comment', () => {
    const planted = [
      "execFileSync('git', ['init', dir]);",                     // 1: no options
      "execFileSync('git', ['status'], { encoding: 'utf8' });", // 2: options, no env
      "execFileSync('git', [",                                  // 3: an argv over two lines
      "  'init', dir]);",
      "spawnSync('git', ['status'], { env: process.env });",    // 5: the whole environment, by name
      'execSync(`git -C ${dir} status`);',                      // 6: a shell string
      'const e = { ...process.env, HOME: h };',                 // 7: a spread
      "execFileSync('git', ['init', dir], { env: inheritedEnv() });",
      "execFileSync('git', ['init', dir], {\n  encoding: 'utf8',\n  env: { ...inheritedEnv(), HOME: h },\n});",
      "  // execFileSync('git', ['init', dir]);",                // 13: a comment
      'const c = Object.fromEntries(Object.entries(process.env));', // 14: a whole-environment copy
      "execFile('git', ['status'], cb);",                        // 15: execFile, with a callback and no options
      "spawn('git', ['status']);",                               // 16: spawn
      'execFileSync("git", [\'status\']);',                      // 17: the command in double quotes
    ].join('\n');
    expect(hitsIn('planted', planted)).toEqual([
      'planted:7: const e = { ...process.env, HOME: h };',
      'planted:14: const c = Object.fromEntries(Object.entries(process.env));',
      "planted:1: execFileSync('git', ['init', dir])",
      "planted:2: execFileSync('git', ['status'], { encoding: 'utf8' })",
      "planted:3: execFileSync('git', [ 'init', dir])",
      "planted:5: spawnSync('git', ['status'], { env: process.env })",
      'planted:6: execSync(`git -C ${dir} status`)',
      "planted:15: execFile('git', ['status'], cb)",
      "planted:16: spawn('git', ['status'])",
      'planted:17: execFileSync("git", [\'status\'])',
    ]);
  });

  it('no `...process.env` spread, no `entries(process.env)`, and no git spawn that names no env', () => {
    const files = fs.readdirSync(__dirname).filter((f) => SCOPE.test(f)).sort();
    expect(files, 'the CONTROL: the scope finds the suites')
      .toEqual(expect.arrayContaining(['ccdWsHelpers.ts', 'childReclaimFixture.ts', 'ccd-child-reclaim-hardening.test.ts', 'ccd-ws-expire-reach.test.ts']));
    const hits = files.flatMap((f) => hitsIn(f, fs.readFileSync(path.join(__dirname, f), 'utf8')));
    expect(hits).toEqual([]);
  });
});
