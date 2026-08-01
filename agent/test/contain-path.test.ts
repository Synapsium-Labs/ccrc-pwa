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
    // The proof, stated as the thing we actually care about: run the exact argv
    // that killed the box, and show it cannot reach a real tmux server. If this
    // ever passes through to the real binary, it takes every ccrc session with
    // it — so this test asserts the stub answered, not merely that it exists.
    const r = spawnSync('tmux', ['kill-server'], { encoding: 'utf8' });
    expect(r.status, 'the contained tmux refuses everything').toBe(1);
    expect(r.stderr).toContain('contained-tmux refuses');
    expect(r.stderr).toContain('kill-server');
  });
});
