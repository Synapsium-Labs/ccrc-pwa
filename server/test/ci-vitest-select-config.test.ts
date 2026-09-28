// `server/vitest.select.config.ts` (spec §7.2, contract Task 2): CCRC_TEST_LIST unset behaves exactly like
// vitest.config.ts; set, test.include becomes EXACTLY the listed paths (never appended to the base glob —
// mergeConfig concatenates array fields, which this config works around; see its own header comment).
//
// Each scenario spawns a fresh `tsx` process to import the config module, rather than re-importing it in-process
// with a cache-busting query string: vite's `vite:oxc` transform plugin, hit with several concurrent
// differently-queried imports of the SAME underlying path in one process (which is what repeated
// `import('...ts?t=...')` calls in a single vitest worker do), was observed to intermittently mis-parse the file
// it had just transformed correctly moments before — a caching race in the dev transform pipeline, not a defect
// in this repo's code. A fresh process per scenario is also closer to how CI actually loads this file: each
// `vitest run --config vitest.select.config.ts` invocation is its own process.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const tsx = path.join(serverRoot, 'node_modules', '.bin', 'tsx');

/** Runs the select config module in a fresh `tsx` process (optionally with `CCRC_TEST_LIST` set) and returns its
 *  resolved `test` block, or throws with the child's stderr on a non-zero exit. */
function loadSelectConfig(listFile?: string): { test: Record<string, unknown> } {
  const target = path.join(serverRoot, 'vitest.select.config.ts').replace(/\\/g, '/');
  const script = [
    `import mod from '${target}';`,
    'process.stdout.write(JSON.stringify(mod));',
  ].join('\n');
  const dir = mkTmp('ccrc-select-cfg-runner-');
  const scriptFile = path.join(dir, 'run.mts');
  writeFileSync(scriptFile, script, 'utf8');
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (listFile === undefined) delete env.CCRC_TEST_LIST;
  else env.CCRC_TEST_LIST = listFile;
  const out = execFileSync(tsx, [scriptFile], { cwd: serverRoot, env, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out);
}

function loadBaseConfig(): { test: Record<string, unknown> } {
  const target = path.join(serverRoot, 'vitest.config.ts').replace(/\\/g, '/');
  const script = [
    `import mod from '${target}';`,
    'process.stdout.write(JSON.stringify(mod));',
  ].join('\n');
  const dir = mkTmp('ccrc-base-cfg-runner-');
  const scriptFile = path.join(dir, 'run.mts');
  writeFileSync(scriptFile, script, 'utf8');
  const out = execFileSync(tsx, [scriptFile], { cwd: serverRoot, encoding: 'utf8' });
  rmSync(dir, { recursive: true, force: true });
  return JSON.parse(out);
}

describe('vitest.select.config.ts', () => {
  it('is identical to vitest.config.ts when CCRC_TEST_LIST is unset', () => {
    const select = loadSelectConfig(undefined);
    const base = loadBaseConfig();
    expect(select.test).toEqual(base.test);
  });

  it('replaces test.include with exactly the listed paths when CCRC_TEST_LIST is set', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, 'test/foo.test.ts\ntest/bar.test.ts\n\n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    expect(cfg.test.include).toEqual(['test/foo.test.ts', 'test/bar.test.ts']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('blank lines in CCRC_TEST_LIST are ignored', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, '\ntest/only.test.ts\n\n  \n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    expect(cfg.test.include).toEqual(['test/only.test.ts']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('does NOT append the exact list onto the base glob (the mergeConfig array-concat trap)', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, 'test/only.test.ts\n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    expect(cfg.test.include).not.toContain('test/**/*.test.ts');
    expect(cfg.test.include).toHaveLength(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws a clear error when CCRC_TEST_LIST points at a missing file', () => {
    expect(() => loadSelectConfig('/nonexistent/does-not-exist.txt')).toThrowError(/CCRC_TEST_LIST/);
  });

  it('throws a clear error when CCRC_TEST_LIST points at an empty file', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'empty.txt');
    writeFileSync(listFile, '\n   \n', 'utf8');
    expect(() => loadSelectConfig(listFile)).toThrowError();
    try {
      loadSelectConfig(listFile);
    } catch (e) {
      expect(String((e as { stderr?: Buffer }).stderr ?? e)).toMatch(/empty/);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it('preserves non-include fields (testTimeout, maxWorkers) from the base config', () => {
    const dir = mkTmp('ccrc-select-cfg-');
    const listFile = path.join(dir, 'tests.txt');
    writeFileSync(listFile, 'test/only.test.ts\n', 'utf8');
    const cfg = loadSelectConfig(listFile);
    const base = loadBaseConfig();
    expect(cfg.test.testTimeout).toBe(base.test.testTimeout);
    expect(cfg.test.maxWorkers).toBe(base.test.maxWorkers);
    rmSync(dir, { recursive: true, force: true });
  });
});
