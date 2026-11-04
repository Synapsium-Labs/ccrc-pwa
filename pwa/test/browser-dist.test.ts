// The browser leg builds the production PWA ONCE per run (2026-11-02). 47 of the 48 browser files used to run their
// own `vite build` in beforeAll, 47 builds of one output a run; `browser/globalSetup.ts` now builds it once, seals it
// read-only, and provides its directory to every file, which reads it with `sharedDist()` (`browser/app.ts`). Pinned
// here from the hermetic run, with a stand-in builder, so no case runs vite:
//
// - the browser config names the global setup, and no browser file builds its own app or removes the shared one;
// - the global setup builds exactly once, provides the built directory sealed (a write into it is refused), and its
//   teardown removes it;
// - a build that fails fails the run: nothing is provided, the setup throws the build's error;
// - `sharedDist()` in a run that provided nothing throws, naming the global setup, rather than serving nothing.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfigFromFile } from 'vite';
import { DIST_KEY, removeDist, sealDist } from '../browser/dist';
import { buildOnce } from '../browser/globalSetup';
import { sharedDist } from '../browser/app';

const PWA = path.join(import.meta.dirname, '..');
const BROWSER = path.join(PWA, 'browser');
const scratch = mkdtempSync(path.join(tmpdir(), 'ccrc-browser-dist-test-'));
afterAll(() => {
  removeDist(scratch);
});

/** A stand-in for `buildDist`: a fresh directory holding an index.html, an assets/ directory and a file inside it. */
function fakeBuild(): string {
  const out = mkdtempSync(path.join(scratch, 'dist-'));
  writeFileSync(path.join(out, 'index.html'), '<!doctype html><title>ccrc</title>');
  mkdirSync(path.join(out, 'assets'));
  writeFileSync(path.join(out, 'assets', 'app.js'), 'console.log(1)');
  return out;
}

/** What `project.provide` was handed, keyed by name. */
function fakeProject(): { provided: Map<string, unknown>; project: { provide: (key: string, value: string) => void } } {
  const provided = new Map<string, unknown>();
  return { provided, project: { provide: (key, value) => void provided.set(key, value) } };
}

const browserFiles = (): string[] => readdirSync(BROWSER).filter((f) => /\.browser\.test\.tsx?$/.test(f));
const textOf = (f: string): string => readFileSync(path.join(BROWSER, f), 'utf8');

describe('the browser config builds the app once, in its global setup', () => {
  it('vitest.browser.config.ts names browser/globalSetup.ts as its one global setup', async () => {
    // Loaded as vite loads it, bundled and imported natively (see browser-leg.test.ts's loadConfig for why).
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, path.join(PWA, 'vitest.browser.config.ts'), PWA);
    expect(loaded?.config.test?.globalSetup).toEqual(['browser/globalSetup.ts']);
  });

  it('no browser file builds its own app or removes the shared one; every file that serves the app serves sharedDist()', () => {
    const files = browserFiles();
    expect(files.length, 'no browser file found, so this case would prove nothing').toBeGreaterThan(3);
    expect(files.filter((f) => /\bbuildDist\b/.test(textOf(f))), 'a browser file runs its own vite build').toEqual([]);
    expect(files.filter((f) => /\bremoveDist\b/.test(textOf(f))), 'a browser file removes the shared build').toEqual([]);
    const serves = files.filter((f) => /\bserveDist\s*\(/.test(textOf(f)));
    expect(serves.length, 'no browser file serves the app, so this case would prove nothing').toBeGreaterThan(3);
    // Each serves exactly the directory sharedDist() returned: `dist = sharedDist()` and then `serveDist(dist)`.
    const unshared = serves.filter((f) => !/\bdist = sharedDist\(\);\n\s*server = await serveDist\(dist\);/.test(textOf(f)));
    expect(unshared, 'a browser file serves a directory that is not the shared build').toEqual([]);
  });

  it('the global setup builds with the real builder, and app.ts no longer exports one', async () => {
    const setup = readFileSync(path.join(BROWSER, 'globalSetup.ts'), 'utf8');
    expect(setup).toMatch(/^export default buildOnce\(\);$/m);
    expect(setup).toMatch(/export function buildOnce\(build: \(\) => string = buildDist\)/);
    const app = await import('../browser/app');
    expect('buildDist' in app, 'app.ts exports a builder again: a browser file could build its own').toBe(false);
    expect('removeDist' in app, 'app.ts exports a remover again: a browser file could remove the shared build').toBe(false);
  });
});

describe('buildOnce: one build, sealed, provided, and removed at teardown', () => {
  it('provides the built directory under the one key sharedDist() reads', () => {
    const { provided, project } = fakeProject();
    const teardown = buildOnce(fakeBuild)(project);
    expect(DIST_KEY).toBe('browserDist');
    const dir = provided.get(DIST_KEY);
    expect(typeof dir).toBe('string');
    expect(existsSync(path.join(dir as string, 'index.html'))).toBe(true);
    expect([...provided.keys()]).toEqual([DIST_KEY]);
    teardown();
  });

  it('builds exactly once per run, however many files will read it', () => {
    let builds = 0;
    const { project } = fakeProject();
    const teardown = buildOnce(() => (builds += 1, fakeBuild()))(project);
    expect(builds).toBe(1);
    teardown();
    expect(builds).toBe(1);
  });

  it('seals the output before providing it: no file can be changed, and nothing can be added or removed', () => {
    const { provided, project } = fakeProject();
    const teardown = buildOnce(fakeBuild)(project);
    const dir = provided.get(DIST_KEY) as string;
    expect(() => writeFileSync(path.join(dir, 'index.html'), 'changed')).toThrow(/EACCES|EPERM/);
    expect(() => writeFileSync(path.join(dir, 'assets', 'new.js'), '')).toThrow(/EACCES|EPERM/);
    expect(() => writeFileSync(path.join(dir, 'new.html'), '')).toThrow(/EACCES|EPERM/);
    expect(() => mkdirSync(path.join(dir, 'extra'))).toThrow(/EACCES|EPERM/);
    expect(readFileSync(path.join(dir, 'index.html'), 'utf8')).toBe('<!doctype html><title>ccrc</title>');
    teardown();
  });

  it('teardown removes the sealed directory', () => {
    const { provided, project } = fakeProject();
    const teardown = buildOnce(fakeBuild)(project);
    const dir = provided.get(DIST_KEY) as string;
    teardown();
    expect(existsSync(dir)).toBe(false);
  });

  it('a build that throws fails the setup and provides nothing', () => {
    const { provided, project } = fakeProject();
    expect(() => buildOnce(() => { throw new Error('vite build failed'); })(project)).toThrow('vite build failed');
    expect(provided.has(DIST_KEY)).toBe(false);
  });

  it('a build the seal refuses fails the setup, provides nothing and leaves no directory behind', () => {
    const { provided, project } = fakeProject();
    let built = '';
    const linked = (): string => {
      built = fakeBuild();
      symlinkSync('/etc', path.join(built, 'out'));
      return built;
    };
    expect(() => buildOnce(linked)(project)).toThrow(/symbolic link, out/);
    expect(provided.has(DIST_KEY)).toBe(false);
    expect(existsSync(built)).toBe(false);
  });
});

describe('sealDist and removeDist', () => {
  it('sealDist leaves every file readable and every directory listable, and nothing writable', () => {
    const dir = fakeBuild();
    sealDist(dir);
    expect(readdirSync(dir).sort()).toEqual(['assets', 'index.html']);
    expect(readFileSync(path.join(dir, 'assets', 'app.js'), 'utf8')).toBe('console.log(1)');
    for (const p of [dir, path.join(dir, 'assets'), path.join(dir, 'index.html'), path.join(dir, 'assets', 'app.js')]) {
      expect(statSync(p).mode & 0o222, p).toBe(0);
      expect(statSync(p).mode & 0o444, p).toBe(0o444);
    }
    removeDist(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it('removeDist of a directory that is not there, or of undefined, is a no-op', () => {
    expect(() => removeDist(path.join(scratch, 'never-built'))).not.toThrow();
    expect(() => removeDist(undefined)).not.toThrow();
  });
});

describe('sharedDist: only a run whose global setup provided the build can read it', () => {
  it('throws, naming the global setup, when nothing was provided (this hermetic run provides nothing)', () => {
    expect(() => sharedDist()).toThrow(/browser\/globalSetup\.ts/);
  });
});
