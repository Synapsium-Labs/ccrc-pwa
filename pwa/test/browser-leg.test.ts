// The real-browser leg's wiring, pinned from the hermetic run (native Docs reader spec 2026-10-01 5.7; W5 part 1
// Task 12), and the two halves of the dev alias's scope (W4 review 412, residue R1).
//
// - The hermetic config (`vite.config.ts`'s `test` block) excludes `browser/**`, so `npm test` never needs a Chrome,
//   and the browser config (`vitest.browser.config.ts`) collects the browser files and nothing else. Both are read
//   twice: as the config objects, and as the file lists vitest itself prints for each config (`vitest list
//   --filesOnly --json`, in a child process with no VITEST variables), so a glob that looks right but collects the
//   wrong files is red too.
// - The sequencer (`browser/slowFirst.ts`) starts measured files slowest first, every name it measures is a browser
//   file, and its `--shard` answer (CI's legs, split by measured time in `browser/legs.ts`) partitions exactly the
//   list vitest collects under the browser config. The split's own rules are `test/browser-legs.test.ts`.
// - `package.json` carries `test:browser` and `playwright-core` at an exact version, which the lock agrees with.
// - `resolveChrome` (`browser/harness.ts`) throws when neither `CCRC_CHROME` nor its fallback is an executable file:
//   that throw is what makes a box with no Chrome a red leg rather than a skipped one.
// - `devWorkerSafeEntries` (`vite.config.ts`) applies only when serving, and never under vitest: each half has its own
//   case, measured by calling the plugin's own `apply` with VITEST unset and then set.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { configDefaults } from 'vitest/config';
import { loadConfigFromFile, type ConfigEnv, type Plugin, type PluginOption, type UserConfig } from 'vite';
import { DEFAULT_CHROME, resolveChrome } from '../browser/harness';
import type { TestSpecification, Vitest } from 'vitest/node';
import { MEASURED_SECONDS, splitLegs } from '../browser/legs';
import { SLOW_FIRST, SlowFirstSequencer, slowFirst } from '../browser/slowFirst';

const PWA = path.join(import.meta.dirname, '..');

// The two configs are loaded as vite loads them, bundled and imported natively (`loadConfigFromFile`), never through
// this run's own transform: vite's asset plugin rewrites a literal `new URL('../ui/src', import.meta.url)`, which is
// how vite.config.ts resolves main's `@` alias, into an `http://localhost` URL under the jsdom environment, and
// `fileURLToPath` then throws at import (measured: `The URL must be of scheme file`).
async function loadConfig(file: string): Promise<UserConfig> {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, path.join(PWA, file), PWA);
  if (loaded === null) throw new Error(`no config at ${file}`);
  return loaded.config;
}
const hermetic = await loadConfig('vite.config.ts');
const browserConfig = await loadConfig('vitest.browser.config.ts');
const BROWSER_INCLUDE = 'browser/**/*.browser.test.{ts,tsx}';

/** The test files vitest itself collects under `configFile` (null = the default, `vite.config.ts`), relative to the
 *  package root, sorted. Run in a child with only PATH and HOME, so no VITEST variable of this run leaks into it. */
function listed(configFile: string | null): string[] {
  const env: Record<string, string> = { PATH: process.env['PATH'] ?? '' };
  if (process.env['HOME'] !== undefined) env['HOME'] = process.env['HOME'];
  const args = ['list', '--filesOnly', '--json', ...(configFile === null ? [] : ['--config', configFile])];
  const stdout = execFileSync(path.join(PWA, 'node_modules', '.bin', 'vitest'), args,
    { cwd: PWA, env, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
  const files = JSON.parse(stdout.slice(stdout.indexOf('['))) as { file: string }[];
  return files.map((f) => path.relative(PWA, f.file).split(path.sep).join('/')).sort();
}

describe('the hermetic run never collects the browser leg; the browser config collects only it (spec 5.7)', () => {
  it("vite.config.ts's test.exclude is vitest's own defaults plus browser/**", () => {
    expect(hermetic.test?.exclude).toEqual([...configDefaults.exclude, 'browser/**']);
  });

  it('vitest lists no browser/ file under the hermetic config, and does list this file', () => {
    const files = listed(null);
    expect(files, 'the hermetic list is empty, so this case would prove nothing').toContain('test/browser-leg.test.ts');
    expect(files.filter((f) => f.startsWith('browser/'))).toEqual([]);
  }, 150_000);

  it('the browser config: its include, a jsdom environment, 60 s per test and per hook', () => {
    expect(browserConfig.test?.include).toEqual([BROWSER_INCLUDE]);
    expect(browserConfig.test?.environment).toBe('jsdom');
    expect(browserConfig.test?.testTimeout).toBe(60000);
    expect(browserConfig.test?.hookTimeout).toBe(60000);
  });

  // C12 item 11: the files that set the leg's wall time start first. Every measured name is checked against the tree, so
  // a renamed or deleted slow file reds here rather than silently becoming an unmeasured one in the split.
  it('the browser config starts the slowest files first, and each one it names is a browser file', () => {
    // The config is bundled when it is loaded, so its class is a copy of the module's: compared by name.
    expect(browserConfig.test?.sequence?.sequencer?.name).toBe(SlowFirstSequencer.name);
    expect(SLOW_FIRST, 'SLOW_FIRST is not every measured file').toEqual(expect.arrayContaining(Object.keys(MEASURED_SECONDS)));
    for (const name of SLOW_FIRST) expect(existsSync(path.join(PWA, name)), name).toBe(true);
    expect(SLOW_FIRST.map((f) => MEASURED_SECONDS[f]), 'SLOW_FIRST is not slowest first')
      .toEqual(SLOW_FIRST.map((f) => MEASURED_SECONDS[f]).sort((a, b) => b! - a!));
    // An unmeasured file starts before every measured one; ties keep the order given.
    const files = ['browser/a.browser.test.ts', ...[...SLOW_FIRST].reverse(), 'browser/b.browser.test.ts'];
    expect(slowFirst(files, (f) => f)).toEqual(['browser/a.browser.test.ts', 'browser/b.browser.test.ts', ...SLOW_FIRST]);
  });

  // The CI legs (`--shard=<i>/<n>`, ci.yml's browser-pwa matrix) are the sequencer's own `shard` over the specs vitest
  // hands it. Driven here with the very list vitest collects under the browser config: the legs together are that list,
  // each file in exactly one, so a browser file can neither be skipped nor run twice by the split.
  it("the sequencer's --shard legs partition exactly the files vitest collects under the browser config", async () => {
    const files = listed('vitest.browser.config.ts');
    expect(files.length, 'the browser list is empty, so this case would prove nothing').toBeGreaterThan(3);
    const specs = files.map((f) => ({ moduleId: path.join(PWA, f) }) as unknown as TestSpecification);
    const legOf = async (index: number, count: number): Promise<string[]> => {
      const ctx = { config: { root: PWA, shard: { index, count } } } as unknown as Vitest;
      const got = await new SlowFirstSequencer(ctx).shard([...specs]);
      return got.map((s) => path.relative(PWA, s.moduleId).split(path.sep).join('/'));
    };
    for (const count of [2, 3]) {
      const legs = await Promise.all(Array.from({ length: count }, (_, i) => legOf(i + 1, count)));
      for (const [i, leg] of legs.entries()) expect(leg.length, `leg ${i + 1}/${count} is empty`).toBeGreaterThan(0);
      expect(legs.flat().sort(), `${count} legs`).toEqual(files);
      // The time-balanced split, not vitest's hash split (which partitions too, blind to time).
      expect(legs, `${count} legs`).toEqual(splitLegs(files, count));
    }
    // No --shard: the sequencer hands back every file.
    const ctx = { config: { root: PWA } } as unknown as Vitest;
    expect(await new SlowFirstSequencer(ctx).shard([...specs])).toHaveLength(files.length);
  }, 150_000);

  it('vitest lists at least one file under the browser config, every one under browser/ and named *.browser.test.*', () => {
    const files = listed('vitest.browser.config.ts');
    expect(files).toContain('browser/docs-headers.browser.test.ts');
    expect(files.filter((f) => !/^browser\/.+\.browser\.test\.tsx?$/.test(f))).toEqual([]);
  }, 150_000);
});

describe('package.json: the leg\'s script and its one package', () => {
  const pkg = JSON.parse(readFileSync(path.join(PWA, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>; dependencies: Record<string, string>; devDependencies: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(path.join(PWA, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; dev?: boolean; devDependencies?: Record<string, string> }>;
  };

  it('"test:browser" runs vitest on the browser config', () => {
    expect(pkg.scripts['test:browser']).toBe('vitest run --config vitest.browser.config.ts');
  });

  it('playwright-core is an exact-version devDependency, and the lock installs that version', () => {
    const v = pkg.devDependencies['playwright-core'];
    expect(v, 'playwright-core is not a devDependency').toBeDefined();
    expect(v, 'a range, not an exact version').toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.dependencies['playwright-core'], 'playwright-core would ship in the bundle').toBeUndefined();
    expect(lock.packages['']?.devDependencies?.['playwright-core']).toBe(v);
    expect(lock.packages['node_modules/playwright-core']?.version).toBe(v);
    expect(lock.packages['node_modules/playwright-core']?.dev).toBe(true);
  });
});

describe('resolveChrome: no Chrome is a red leg, never a skipped one (spec 5.7)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ccrc-chrome-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'chrome');
  writeFileSync(exe, '#!/bin/sh\n');
  chmodSync(exe, 0o755);
  const plain = path.join(dir, 'not-executable');
  writeFileSync(plain, '#!/bin/sh\n');
  chmodSync(plain, 0o644);
  const folder = path.join(dir, 'a-directory');
  mkdirSync(folder);
  const missing = path.join(dir, 'missing');

  it('CCRC_CHROME naming an executable file wins', () => {
    expect(resolveChrome({ CCRC_CHROME: exe }, missing)).toBe(exe);
  });

  it('with CCRC_CHROME unset, empty or missing, the fallback is taken when it is an executable file', () => {
    expect(resolveChrome({}, exe)).toBe(exe);
    expect(resolveChrome({ CCRC_CHROME: '' }, exe)).toBe(exe);
    expect(resolveChrome({ CCRC_CHROME: missing }, exe)).toBe(exe);
  });

  it('CCRC_CHROME at a missing path and no fallback: it THROWS, naming both', () => {
    expect(() => resolveChrome({ CCRC_CHROME: missing }, missing)).toThrow(/no Chrome for the browser leg/);
    expect(() => resolveChrome({ CCRC_CHROME: missing }, missing)).toThrow(JSON.stringify(missing));
    expect(() => resolveChrome({}, missing)).toThrow(`CCRC_CHROME is unset, and ${missing} is not an executable file`);
  });

  it('a file that is not executable, or a directory, is not a Chrome', () => {
    expect(() => resolveChrome({ CCRC_CHROME: plain }, missing)).toThrow(/no Chrome/);
    expect(() => resolveChrome({ CCRC_CHROME: folder }, missing)).toThrow(/no Chrome/);
    expect(() => resolveChrome({}, folder)).toThrow(/no Chrome/);
  });

  it('the default fallback is /usr/bin/google-chrome (where ubuntu-latest has Chrome)', () => {
    expect(DEFAULT_CHROME).toBe('/usr/bin/google-chrome');
    if (existsSync(DEFAULT_CHROME)) expect(resolveChrome({ CCRC_CHROME: missing })).toBe(DEFAULT_CHROME);
    else expect(() => resolveChrome({ CCRC_CHROME: missing })).toThrow(`${DEFAULT_CHROME} is not an executable file`);
  });
});

/** Every plugin object in a config's (possibly nested, possibly async-free) plugin list. */
function flatPlugins(list: PluginOption[] | undefined): Plugin[] {
  const out: Plugin[] = [];
  const walk = (p: PluginOption): void => {
    if (Array.isArray(p)) p.forEach(walk);
    else if (p !== null && typeof p === 'object' && 'name' in p) out.push(p);
  };
  (list ?? []).forEach(walk);
  return out;
}

describe("the dev alias's scope: serve only, never under vitest (W4 review 412, residue R1)", () => {
  const alias = flatPlugins(hermetic.plugins).filter((p) => p.name === 'ccrc-dev-worker-safe-entries');
  const apply = (command: ConfigEnv['command']): boolean => {
    const a = alias[0]?.apply;
    expect(typeof a, 'the dev alias has no apply function').toBe('function');
    return (a as (config: UserConfig, env: ConfigEnv) => boolean)({}, { command, mode: 'development' });
  };
  /** Run `f` with VITEST unset, as `npm run dev` and `npm run build` see the environment, then restore it. */
  const outsideVitest = <T>(f: () => T): T => {
    const saved = process.env['VITEST'];
    delete process.env['VITEST'];
    try { return f(); } finally { if (saved !== undefined) process.env['VITEST'] = saved; }
  };

  it('is registered once, in the main plugin list', () => {
    expect(alias).toHaveLength(1);
  });

  it('half 1: outside vitest it applies when serving and never when building', () => {
    expect(outsideVitest(() => apply('serve'))).toBe(true);
    expect(outsideVitest(() => apply('build'))).toBe(false);
  });

  it('half 2: under vitest (VITEST set, as now) it does not apply, even when serving', () => {
    expect(process.env['VITEST'], 'this case must run under vitest').toBeDefined();
    expect(apply('serve')).toBe(false);
    expect(apply('build')).toBe(false);
  });
});
