// `ccrc restamp <file>` — the regenerator for a `# ccrc:generated` stamp
// (landing-order spec 2026-09-23 §5.1, "The regenerator gets a CLI"). Worker
// clause 16 says a generated stamp is never hand-resolved: take either side of
// the stamp LINE only, resolve the rest of the file as source, then run its
// regenerator. For `ccd/ccd` that regenerator was a four-line `node -e` every
// plan re-typed, and 17 of 25 hand resolutions measured on that file were the
// stamp alone.
//
// THE GUARDS THAT MATTER are two refusals. A FOREIGN file: a marker is how ccrc
// tells its own output from a human's (`deploy/gen-wrappers.mjs` overwrites a
// wrapper only when `verifyMarker` says ccrc wrote it), so a restamp that
// stamped an unmarked file would ADOPT it — and make a hand-written file
// overwritable by the next generator run. And a GENERATOR'S OWN OUTPUT (a
// wrapper in `~/.local/bin`, a file under `~/.ccrc`): its generator reads
// `ccrc-edited` as a hand edit to keep, so a restamp there would hand that
// edit to the next `ccrc wrappers` to overwrite. Restamp re-stamps a source
// file's stamp; it never adopts, and it never launders a generator's output.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { ghContainedEnv } from './ccdWsHelpers.js';
import { markGenerated, verifyMarker } from '../../shared/mark.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CCRC = path.resolve(here, '..', '..', 'ccd', 'ccrc');

const run = (args: string[], home = mkTmp('ccrc-restamp-home-')): { home: string; code: number; stdout: string; stderr: string } => {
  const r = spawnSync('bash', [CCRC, 'restamp', ...args],
    { env: ghContainedEnv(home, { ...process.env, HOME: home }), encoding: 'utf8' });
  return { home, code: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

const BODY = '#!/usr/bin/env bash\n# a generated file\necho one\n';
/** A stamped file whose body changed after the stamp — the shape a merge of
 *  main leaves `ccd/ccd` in when either side is taken. */
const staleStamped = (): string =>
  markGenerated(BODY).replace('echo one', 'echo two');

describe('ccrc restamp <file>', () => {
  it('re-stamps a stamped file whose body moved, to exactly what markGenerated writes', () => {
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, staleStamped(), { mode: 0o755 });
    expect(verifyMarker(readFileSync(f, 'utf8'))).toBe('ccrc-edited');
    const r = run([f]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('restamped');
    const after = readFileSync(f, 'utf8');
    expect(verifyMarker(after)).toBe('ccrc-unmodified');
    expect(after).toBe(markGenerated(staleStamped()));
    expect(after.split('\n')[0], 'the shebang stays physically first').toBe('#!/usr/bin/env bash');
    expect(statSync(f).mode & 0o777, 'the mode survives').toBe(0o755);
  });

  it('leaves a current stamp byte-identical and says so', () => {
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, markGenerated(BODY));
    const before = readFileSync(f);
    const r = run([f]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain('already current');
    expect(readFileSync(f).equals(before)).toBe(true);
  });

  it('REFUSES a file with no marker and leaves it untouched — restamp never adopts', () => {
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'hand-written');
    writeFileSync(f, BODY);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('carries no ccrc:generated marker');
    expect(readFileSync(f, 'utf8')).toBe(BODY);
  });

  it("refuses a generator's own output — a wrapper in ~/.local/bin, a file under ~/.ccrc — and leaves it untouched", () => {
    const home = mkTmp('ccrc-restamp-home-');
    for (const rel of ['.local/bin/acct-demo', '.ccrc/accounts.sh']) {
      const f = join(home, rel);
      mkdirSync(path.dirname(f), { recursive: true });
      writeFileSync(f, staleStamped());
      const r = run([f], home);
      expect(r.code, `${rel} was restamped`).toBe(1);
      expect(r.stderr).toContain("is a generator's output");
      expect(readFileSync(f, 'utf8')).toBe(staleStamped());
    }
  });

  it('refuses a symlink rather than stamping what it points at', () => {
    const dir = mkTmp('ccrc-restamp-');
    const target = join(dir, 'target');
    writeFileSync(target, staleStamped());
    const link = join(dir, 'link');
    symlinkSync(target, link);
    const r = run([link]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is not a regular file');
    expect(readFileSync(target, 'utf8')).toBe(staleStamped());
  });

  it('refuses a path that does not exist, exit 1', () => {
    const r = run([join(mkTmp('ccrc-restamp-'), 'absent')]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is not a regular file');
  });

  it('is a usage error, exit 2, with no file or with two', () => {
    expect(run([]).code).toBe(2);
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, staleStamped());
    expect(run([f, f]).code).toBe(2);
    expect(readFileSync(f, 'utf8'), 'a usage error writes nothing').toBe(staleStamped());
  });

  it('reports a file it cannot write, exit 1, and leaves it as it was', () => {
    if (process.getuid?.() === 0) return;   // root writes through 0444
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, staleStamped());
    chmodSync(f, 0o444);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(readFileSync(f, 'utf8')).toBe(staleStamped());
  });

  it("refuses a generator's output named by a RELATIVE path even when CDPATH would resolve it elsewhere", () => {
    // `cd` consults an exported CDPATH for a relative operand and PRINTS the
    // directory it found, so a scope check built on `cd "$(dirname "$f")"` could
    // be resolved to a decoy while the write lands on the real file.
    const home = mkTmp('ccrc-restamp-home-');
    const real = join(home, '.ccrc', 'sub', 'f');
    mkdirSync(path.dirname(real), { recursive: true });
    writeFileSync(real, staleStamped());
    const decoyRoot = mkTmp('ccrc-restamp-cdpath-');
    mkdirSync(join(decoyRoot, 'sub'), { recursive: true });
    writeFileSync(join(decoyRoot, 'sub', 'f'), staleStamped());
    const r = spawnSync('bash', [CCRC, 'restamp', 'sub/f'], {
      cwd: join(home, '.ccrc'),
      env: ghContainedEnv(home, { ...process.env, HOME: home, CDPATH: decoyRoot }),
      encoding: 'utf8',
    });
    expect(r.status, r.stdout + r.stderr).toBe(1);
    expect(r.stderr).toContain("is a generator's output");
    expect(readFileSync(real, 'utf8'), 'the file under ~/.ccrc was rewritten').toBe(staleStamped());
  });
});
