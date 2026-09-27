// server/test/ccgpt-harness.test.ts
import { describe, it, expect } from 'vitest';
import { pythonOrSkip, runPy, runPyAsync, spawnPy, ccgptFile, PYSTUB_DIR } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
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

  // Fix round 2, finding 3: every containment guarantee above is expressed
  // RELATIVE to `opts.home` — a call site that passes anything other than a
  // real `mkTmp()` fixture silently points HOME/cwd at a real directory,
  // with no error. `/etc` names a directory this box's real HOME and the
  // repo checkout both provably are not, so it stands in for "any call site
  // that miscomputed `home`" without asserting anything about a specific
  // wrong value.
  it('runPy refuses a non-fixture opts.home, naming the offending value', () => {
    expect(() => runPy('/does-not-matter.py', { home: '/etc' })).toThrow(/\/etc/);
  });

  it('spawnPy refuses a non-fixture opts.home, naming the offending value', () => {
    expect(() => spawnPy('/does-not-matter.py', { home: '/etc' })).toThrow(/\/etc/);
  });

  // ccgpt-proxy review round 1, commit b56286a4 C-1/I-1/I-2 + Question 2's rider: a second,
  // hand-rolled python-spawn site (ccgpt-proxy.test.ts's original `startPair`)
  // reproduced this containment BY HAND and dropped the fixture HOME the
  // moment a caller spread `...process.env`. `spawnPy` shares `runPy`'s own
  // `containedEnv` helper rather than re-deriving it, so these two cases pin
  // that the shared body actually holds for the long-lived spawn path too —
  // "a single body that nothing pins is a single unpinned body."
  describe('spawnPy shares runPy\'s containment (not a second, hand-rolled body)', () => {
    it('cannot be talked out of the fixture HOME by the realistic opts.env call shape', async () => {
      const home = mkTmp('ccgpt-harness-spawnpy-closed-');
      const f = join(home, 'probe.py');
      writeFileSync(f, 'import os\nprint(os.environ["HOME"])\n');
      const { child } = spawnPy(f, { home, env: { ...process.env, PYTHONPATH: PYSTUB_DIR } });
      let stdout = '';
      child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
      await new Promise<void>((r) => child.once('close', () => r()));
      expect(stdout.trim()).toBe(home);
    });

    it('refuses an opts.env that deliberately sets a different HOME', () => {
      const home = mkTmp('ccgpt-harness-spawnpy-refuse-');
      const f = join(home, 'probe.py');
      writeFileSync(f, 'print("unreached")\n');
      expect(() => spawnPy(f, { home, env: { HOME: '/etc' } })).toThrow(/HOME/);
    });

    // Fix round 2, finding 4: the hoist mutation proves `runPy` and
    // `spawnPy` share ONE body; it does not prove `spawnPy`'s own surface —
    // these two mirror `runPy`'s I3 (cwd) and C2 (.pyc) cases but exercise
    // `spawnPy` DIRECTLY rather than inferring its behaviour from `runPy`'s.
    it('runs the child with the fixture HOME as its cwd, not the repo', async () => {
      const home = mkTmp('ccgpt-harness-spawnpy-cwd-');
      const f = join(home, 'cwd.py');
      writeFileSync(f, 'import os\nprint(os.getcwd())\n');
      const { child } = spawnPy(f, { home });
      let stdout = '';
      child.stdout?.on('data', (c: Buffer) => { stdout += c.toString(); });
      await new Promise<void>((r) => child.once('close', () => r()));
      expect(stdout.trim()).toBe(home);
    });

    it('never leaves a .pyc behind after importing the stub', async () => {
      const home = mkTmp('ccgpt-harness-spawnpy-pyc-');
      const f = join(home, 'imp.py');
      writeFileSync(f,
        'from litellm.llms.chatgpt.authenticator import Authenticator\n' +
        'Authenticator().get_access_token()\n');
      const { child } = spawnPy(f, { home, env: { PYTHONPATH: PYSTUB_DIR } });
      await new Promise<void>((r) => child.once('close', () => r()));
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [e.name]);
      const names = walk(PYSTUB_DIR);
      expect(names.some((n) => n === '__pycache__' || n.endsWith('.pyc'))).toBe(false);
    });
  });

  // task-10-fix-rulings.md's D-3157 hoist: `runPyAsync` used to live only in
  // `ccgpt-usage.test.ts`, with no containment case of its own — the review's
  // argument for hoisting it here is exactly that a local copy inherits
  // nothing from this table. These SIX mirror `runPy`'s own cases above
  // (and `spawnPy`'s, which `runPyAsync` is built on) but exercise
  // `runPyAsync` DIRECTLY rather than inferring its behaviour from either.
  describe('runPyAsync shares runPy\'s containment (not a second, hand-rolled body)', () => {
    it('cannot be talked out of the fixture HOME by the realistic opts.env call shape', async () => {
      const home = mkTmp('ccgpt-harness-runpyasync-closed-');
      const f = join(home, 'probe.py');
      writeFileSync(f, 'import os\nprint(os.environ["HOME"])\n');
      const r = await runPyAsync(f, { home, env: { ...process.env, PYTHONPATH: PYSTUB_DIR } });
      expect(r.stdout.trim()).toBe(home);
    });

    it('refuses an opts.env that deliberately sets a different HOME', async () => {
      const home = mkTmp('ccgpt-harness-runpyasync-refuse-');
      const f = join(home, 'probe.py');
      writeFileSync(f, 'print("unreached")\n');
      // The throw happens inside containedSpawnOptions, called synchronously
      // in runPyAsync's own Promise executor — the Promise constructor turns
      // a synchronous throw there into a REJECTION, not a synchronous throw
      // from the outer call, so this is `.rejects`, not `expect(() => ...)`.
      await expect(runPyAsync(f, { home, env: { HOME: '/etc' } })).rejects.toThrow(/HOME/);
    });

    it('runPyAsync refuses a non-fixture opts.home, naming the offending value', async () => {
      await expect(runPyAsync('/does-not-matter.py', { home: '/etc' })).rejects.toThrow(/\/etc/);
    });

    it('runs the child with the fixture HOME as its cwd, not the repo', async () => {
      const home = mkTmp('ccgpt-harness-runpyasync-cwd-');
      const f = join(home, 'cwd.py');
      writeFileSync(f, 'import os\nprint(os.getcwd())\n');
      const r = await runPyAsync(f, { home });
      expect(r.stdout.trim()).toBe(home);
    });

    it('never leaves a .pyc behind after importing the stub', async () => {
      const home = mkTmp('ccgpt-harness-runpyasync-pyc-');
      const f = join(home, 'imp.py');
      writeFileSync(f,
        'from litellm.llms.chatgpt.authenticator import Authenticator\n' +
        'Authenticator().get_access_token()\n');
      await runPyAsync(f, { home, env: { PYTHONPATH: PYSTUB_DIR } });
      const walk = (dir: string): string[] =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(dir, e.name)) : [e.name]);
      const names = walk(PYSTUB_DIR);
      expect(names.some((n) => n === '__pycache__' || n.endsWith('.pyc'))).toBe(false);
    });

    it('distinguishes a timeout from a clean exit via its OWN SIGKILL timer, not spawnSync\'s ETIMEDOUT', async () => {
      const home = mkTmp('ccgpt-harness-runpyasync-timeout-');
      const f = join(home, 'sleepy.py');
      writeFileSync(f, 'import time,sys\nprint("before")\nsys.stdout.flush()\ntime.sleep(5)\n');
      const r = await runPyAsync(f, { home, timeoutMs: 50 });
      expect(r.timedOut).toBe(true);
      expect(r.status).toBe(null);
      expect(r.signal).toBe('SIGKILL');
    });
  });
});
