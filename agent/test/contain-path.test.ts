import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { CONTAIN_PATH_ROOT_ENV } from './contain-path.globalsetup.js';

/** The pin for `contain-path.setup.ts`. Without it the containment is a config
 *  line nobody would miss until the fleet went down again — which is exactly
 *  how it went down the first three times. */
describe('PATH containment', () => {
  it('is actually wired — the setup file ran', () => {
    expect(process.env.CCRC_TEST_CONTAINED_PATH_DIR, 'setupFiles must include test/contain-path.setup.ts').toBeTruthy();
  });

  it('puts the stub FIRST, so nothing later on PATH can shadow it', () => {
    const first = (process.env.PATH ?? '').split(path.delimiter)[0];
    expect(first).toBe(process.env.CCRC_TEST_CONTAINED_PATH_DIR);
  });

  it('makes `tmux kill-server` harmless from inside this suite', () => {
    // This test runs the exact argv that killed the box four times, so it must
    // PROVE the binary it is about to invoke is the stub BEFORE invoking it —
    // and it must never resolve that binary through PATH at call time.
    //
    // The first version of this test did exactly what it exists to forbid: it
    // called `spawnSync('tmux', ['kill-server'])` and relied on the setup file
    // to have made that safe. Then someone deleted the `setupFiles` line to
    // watch the pin go red — the obvious way to check a pin — and the pin
    // resolved the REAL tmux and killed the fleet for the fourth time. A test
    // whose safety depends on the mechanism it is testing is the same loaded
    // gun as the one in exec.test.ts, just aimed by a shorter argument.
    //
    // So: resolve once, assert the resolution is inside the contained
    // directory, and only then execute — by absolute path, never by name. When
    // containment is missing, the assertion throws and nothing is executed at
    // all, which is the behaviour that makes deleting `setupFiles` a safe way
    // to check this pin.
    const dir = process.env.CCRC_TEST_CONTAINED_PATH_DIR;
    expect(dir, 'containment must be wired before this test may execute anything').toBeTruthy();
    const resolved = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' }).stdout.trim();
    expect(
      resolved.startsWith(`${dir}${path.sep}`),
      `tmux must resolve inside the contained dir; got "${resolved}" — REFUSING to run kill-server`,
    ).toBe(true);

    const r = spawnSync(resolved, ['kill-server'], { encoding: 'utf8' });
    expect(r.status, 'the contained tmux refuses everything').toBe(1);
    expect(r.stderr).toContain('contained-tmux refuses');
    expect(r.stderr).toContain('kill-server');
  });

  it('contains `gh` too — the credentialed one', () => {
    // Same gate, same reason, higher stakes. `gh` on this box holds a token with
    // `repo` WRITE scope and no second credential behind it. Under the sweep's
    // `M01_ADD_GH` mutant the whitelist grew a `gh: [['pr']]` entry, exec.test's
    // `gh pr create --repo o/r …` matched it, and the agent ran the real binary
    // against GitHub — the mutant died for the right reason by the wrong
    // mechanism. Nothing in this suite may reach that binary again.
    const dir = process.env.CCRC_TEST_CONTAINED_PATH_DIR;
    expect(dir, 'containment must be wired before this test may execute anything').toBeTruthy();
    const resolved = spawnSync('sh', ['-c', 'command -v gh'], { encoding: 'utf8' }).stdout.trim();
    expect(
      resolved.startsWith(`${dir}${path.sep}`),
      `gh must resolve inside the contained dir; got "${resolved}" — REFUSING to run pr create`,
    ).toBe(true);

    const r = spawnSync(resolved, ['pr', 'create', '--repo', 'o/r'], { encoding: 'utf8' });
    expect(r.status, 'the contained gh refuses everything').toBe(1);
    expect(r.stderr).toContain('contained-gh refuses');
    expect(r.stderr).toContain('pr create');
  });
});

describe('PATH containment cleans up on the failure it exists to cause', () => {
  // FINAL REVIEW, tests finding 1. `contain-path.setup.ts` made its directory
  // at MODULE SCOPE of a `setupFiles` entry and removed it in an `afterAll`.
  // A setup file's body runs BEFORE the test module is imported, so a test
  // module that THROWS AT IMPORT leaves the directory with no hook to remove
  // it — one leaked /tmp directory per failed-to-import file.
  //
  // That failure is this project's own security design working correctly:
  // `auditExecWhitelist()` runs at module load and `refuseToBoot` THROWS, so
  // every over-permission mutant turns most of this suite into import
  // failures. The harness leaked worst on exactly the event it exists to
  // cause, and mutation sweeps are this project's method (50-120 runs each).
  // Measured before the fix: one throwing file -> 1 leaked directory; the
  // reviewer's real mutant -> 10, twice. This host hit 95% disk that day.
  //
  // WHY A NESTED RUN AND NOT AN INTROSPECTION. `tmpfixtures.test.ts` asserts
  // that both registrations are PRESENT in the source; that is a text check and
  // it cannot tell you whether they FIRE. Nothing inside this process can
  // observe its own exit handler, and the leak only appears in a run whose test
  // module never imported — a run this file is not having. So the pin spawns a
  // real vitest with the real setup file and a test module that throws at
  // import, points the child's TMPDIR at a directory of our own, and counts.
  //
  // Nothing here can reach the real /tmp, the real HOME, or any real binary:
  // the child's TMPDIR is inside a `mkTmp` fixture, and it runs two files that
  // contain a `throw` and an `expect`.
  it('leaves no temp directory behind when a test module throws at import', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const agentRoot = path.resolve(here, '..');
    const req = createRequire(import.meta.url);
    const VITEST = path.resolve(path.dirname(req.resolve('vitest/package.json')), 'vitest.mjs');

    // DERIVED from the real config, not restated. The child must run whatever
    // `vitest.config.ts` actually names, so that unwiring either entry breaks
    // this pin instead of quietly narrowing what it covers.
    const cfgSrc = readFileSync(path.join(agentRoot, 'vitest.config.ts'), 'utf8');
    const entries = (key: string): string[] => {
      const m = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(cfgSrc);
      expect(m, `${key} is not wired in vitest.config.ts`).toBeTruthy();
      const files = [...m![1]!.matchAll(/'([^']+)'/g)].map((x) => path.resolve(agentRoot, x[1]!));
      expect(files.length, `${key} names no files`).toBeGreaterThan(0);
      return files;
    };
    const setupFiles = entries('setupFiles');
    const globalSetup = entries('globalSetup');

    const scratch = mkTmp('ccrc-agent-containpath-pin-');
    const childTmp = path.join(scratch, 'tmp');
    mkdirSync(childTmp);
    const marker = path.join(scratch, 'ran');

    // The throwing module is the case under test. The passing module is the
    // POSITIVE CONTROL: without it, "zero directories" would also be the
    // reading if the setup file never ran in the child at all.
    writeFileSync(path.join(scratch, 'throws.test.ts'),
      'throw new Error("deliberate module-load throw — the shape whitelist.ts produces on purpose");\n');
    writeFileSync(path.join(scratch, 'passes.test.ts'),
      "import { writeFileSync } from 'node:fs';\n"
      + 'it("records that the setup file ran in the child", () => {\n'
      + '  const d = process.env.CCRC_TEST_CONTAINED_PATH_DIR ?? "";\n'
      + '  expect(d).not.toBe("");\n'
      + `  writeFileSync(${JSON.stringify(marker)}, d);\n`
      + '});\n');

    // A PLAIN OBJECT, not `defineConfig`: the config lives outside the package,
    // so it must not import anything that needs `node_modules` resolution from
    // there. `globals` for the same reason — `passes.test.ts` gets `it`/`expect`
    // without an import. `setupFiles`/`globalSetup` are the REAL files by
    // absolute path, which is the whole point: this pin must break when either
    // of them changes, and it must break when either is unwired above.
    writeFileSync(path.join(scratch, 'vitest.config.mjs'),
      'export default { test: { globals: true, include: ["*.test.ts"], '
      + `setupFiles: ${JSON.stringify(setupFiles)}, `
      + `globalSetup: ${JSON.stringify(globalSetup)} } };\n`);

    // THIS process is itself running under the global setup, so its environment
    // already names a run root under the REAL /tmp. Inheriting it would send the
    // child's stub directories out of `childTmp` — and the count below would
    // then read zero for the wrong reason, which is the one way this pin could
    // pass while the leak was back.
    const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: childTmp, CI: '1' };
    delete env[CONTAIN_PATH_ROOT_ENV];

    const r = spawnSync(process.execPath, [VITEST, 'run', '--root', scratch], {
      cwd: scratch, encoding: 'utf8', env,
    });

    const left = readdirSync(childTmp).filter((f) => f.startsWith('ccrc-agent-containpath-'));
    const detail = `\n--- child stdout ---\n${r.stdout}\n--- child stderr ---\n${r.stderr}`;

    // POSITIVE CONTROLS first, so a broken harness reads as a broken harness
    // rather than as a clean result. "Zero directories left" is also what you
    // get if the setup file never ran, or if it ran but wrote somewhere this
    // test is not looking.
    const containedDir = readFileSync(marker, 'utf8');
    expect(containedDir, `the setup file did not run in the child${detail}`)
      .toContain('ccrc-agent-containpath-');
    expect(containedDir.startsWith(childTmp + path.sep),
      `the child's stub dir went to ${containedDir}, outside the directory this pin counts${detail}`).toBe(true);
    expect(r.stdout + r.stderr, `the throwing module did not fail to import${detail}`)
      .toMatch(/1 failed/);

    expect(left, `contain-path leaked ${left.length} temp dir(s) on a module-load failure${detail}`)
      .toEqual([]);
  }, 180_000);
});
