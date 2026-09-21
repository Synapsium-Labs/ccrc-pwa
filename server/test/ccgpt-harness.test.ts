// server/test/ccgpt-harness.test.ts
import { describe, it, expect } from 'vitest';
import { pythonOrSkip, runPy, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

describe('the ccgpt python harness', () => {
  it('runs a python file in a fixture HOME and reports its exit status', () => {
    const py = pythonOrSkip();
    if (!py) return;                       // a box with no python3 skips, loudly in the name
    const home = mkTmp('ccgpt-harness-');
    const f = join(home, 'probe.py');
    writeFileSync(f, 'import os,sys\nprint(os.environ["HOME"])\nsys.exit(7)\n');
    const r = runPy(f, { home });
    expect(r.status).toBe(7);
    expect(r.stdout.trim()).toBe(home);    // HOME is the fixture, never the real one
  });

  it('puts the litellm stub on PYTHONPATH so a hard import resolves', () => {
    const py = pythonOrSkip();
    if (!py) return;
    const home = mkTmp('ccgpt-harness-stub-');
    const f = join(home, 'imp.py');
    writeFileSync(f,
      'from litellm.llms.chatgpt.authenticator import Authenticator\n' +
      'print(Authenticator().get_access_token())\n');
    const r = runPy(f, { home, env: { PYTHONPATH: PYSTUB_DIR } });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('stub-token-not-a-secret');
  });
});
