import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

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
