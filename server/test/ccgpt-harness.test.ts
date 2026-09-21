// server/test/ccgpt-harness.test.ts
import { describe, it, expect } from 'vitest';
import { pythonOrSkip, runPy, ccgptFile, PYSTUB_DIR } from './ccgptHarness';
import { mkTmp } from './tmpHelpers';
import { writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Probed once at module scope (pythonOrSkip() itself memoises further inside
// the harness — see ccgptHarness.ts's `cachedPython`).
const PY = pythonOrSkip();

// I1: a missing interpreter used to make every case below `return` early,
// which vitest reports as a plain green PASS — visually identical to a case
// that actually ran. server/test/usage-sweep.test.ts already spawns python3
// with no availability guard at all, so CI is already red on a leg with no
// python3 before this file runs; this sentinel makes that fact loud HERE
// too, rather than trading it for a silent, contentless green.
it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// `skipIf` prints as a countable "↓ skipped" locally instead of a checkmark
// that looks identical to a real pass — the absence is visible, not silent.
describe.skipIf(!PY)('the ccgpt python harness', () => {
  it('runs a python file in a fixture HOME and reports its exit status', () => {
    const home = mkTmp('ccgpt-harness-');
    const f = join(home, 'probe.py');
    writeFileSync(f, 'import os,sys\nprint(os.environ["HOME"])\nsys.exit(7)\n');
    const r = runPy(f, { home });
    expect(r.status).toBe(7);
    expect(r.stdout.trim()).toBe(home);    // HOME is the fixture, never the real one
  });

  it('puts the litellm stub on PYTHONPATH so a hard import resolves', () => {
    const home = mkTmp('ccgpt-harness-stub-');
    const f = join(home, 'imp.py');
    writeFileSync(f,
      'from litellm.llms.chatgpt.authenticator import Authenticator\n' +
      'print(Authenticator().get_access_token())\n');
    const r = runPy(f, { home, env: { PYTHONPATH: PYSTUB_DIR } });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim()).toBe('stub-token-not-a-secret');
  });

  // C1 — the realistic call shape. A caller who wants PYTHONPATH plus
  // whatever else the ambient shell carries reaches for `...process.env`
  // first; that must not be able to leak the operator's real HOME.
  it('cannot be talked out of the fixture HOME by the realistic opts.env call shape', () => {
    const home = mkTmp('ccgpt-harness-closed-');
    const f = join(home, 'probe.py');
    writeFileSync(f, 'import os\nprint(os.environ["HOME"])\n');
    const r = runPy(f, { home, env: { ...process.env, PYTHONPATH: PYSTUB_DIR } });
    expect(r.stdout.trim()).toBe(home);
  });

  // C1 — a caller who deliberately sets a DIFFERENT HOME (not merely one
  // carried in by a full-env spread) has misunderstood the seam and is told
  // so loudly rather than silently overridden.
  it('refuses an opts.env that deliberately sets a different HOME', () => {
    const home = mkTmp('ccgpt-harness-refuse-');
    const f = join(home, 'probe.py');
    writeFileSync(f, 'print("unreached")\n');
    expect(() => runPy(f, { home, env: { HOME: '/etc' } })).toThrow(/HOME/);
  });

  // I3 — the second containment axis: a relative path the subject writes
  // must land in the fixture, not in the tracked repo tree.
  it('runs the child with the fixture HOME as its cwd, not the repo', () => {
    const home = mkTmp('ccgpt-harness-cwd-');
    const f = join(home, 'cwd.py');
    writeFileSync(f, 'import os\nprint(os.getcwd())\n');
    const r = runPy(f, { home });
    expect(r.stdout.trim()).toBe(home);
  });

  // I2 — a run the harness kills on timeout must be distinguishable from a
  // clean exit, not just another way to get `status: null`.
  it('distinguishes a timeout from a clean exit rather than collapsing both to status: null', () => {
    const home = mkTmp('ccgpt-harness-timeout-');
    const f = join(home, 'sleepy.py');
    writeFileSync(f, 'import time,sys\nprint("before")\nsys.stdout.flush()\ntime.sleep(5)\n');
    const r = runPy(f, { home, timeoutMs: 50 });
    expect(r.timedOut).toBe(true);
    expect(r.status).toBe(null);
  });

  // C2 — the primary fix (PYTHONDONTWRITEBYTECODE) must actually stop the
  // bytes from ever existing, not merely stop them from being committed.
  it('never leaves a .pyc behind after importing the stub', () => {
    const home = mkTmp('ccgpt-harness-pyc-');
    const f = join(home, 'imp.py');
    writeFileSync(f,
      'from litellm.llms.chatgpt.authenticator import Authenticator\n' +
      'Authenticator().get_access_token()\n');
    runPy(f, { home, env: { PYTHONPATH: PYSTUB_DIR } });
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [e.name]);
    const names = walk(PYSTUB_DIR);
    expect(names.some((n) => n === '__pycache__' || n.endsWith('.pyc'))).toBe(false);
  });

  // M1 — the stub's "must never grow one" is a comment; this makes the line
  // a mechanism. Not a linter: a handful of textual checks over four small
  // files, tight enough to catch the first `raise`, import, class, or method
  // the eleven publisher tasks will be tempted to add.
  it('the stub package stays minimal — no imports, no raise, one class with one method', () => {
    const files = [
      'litellm/__init__.py',
      'litellm/llms/__init__.py',
      'litellm/llms/chatgpt/__init__.py',
      'litellm/llms/chatgpt/authenticator.py',
    ].map((f) => join(PYSTUB_DIR, f));
    for (const f of files) {
      const code = readFileSync(f, 'utf8').replace(/#.*$/gm, '');
      expect(code).not.toMatch(/\bimport\b/);
      expect(code).not.toMatch(/\braise\b/);
      expect(code).not.toMatch(/^[A-Za-z_]\w*\s*=/m); // no module-level assignment
    }
    const auth = readFileSync(join(PYSTUB_DIR, 'litellm/llms/chatgpt/authenticator.py'), 'utf8');
    expect((auth.match(/^class \w+/gm) ?? []).length).toBe(1);
    expect((auth.match(/^\s+def \w+/gm) ?? []).length).toBe(1);
  });

  // M3 — a missing shipped ccd/ file must name itself, not surface as a
  // confusing spawn error inside whichever later case ran first.
  it('ccgptFile throws naming the path for a shipped file that does not exist', () => {
    expect(() => ccgptFile('does-not-exist-ccgpt-probe.py')).toThrow(/does-not-exist-ccgpt-probe\.py/);
  });
});
