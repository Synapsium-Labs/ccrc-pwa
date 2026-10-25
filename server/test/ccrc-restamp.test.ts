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
import { chmodSync, copyFileSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkTmp } from './tmpHelpers.js';
import { CCD, ghContainedEnv } from './ccdWsHelpers.js';
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

  // Install-time stamping: ccd/ccd carries no committed stamp, only the fixed placeholder on line 2, and
  // ccd-entry-install.py writes the marker into the INSTALLED copy. A restamp there would put a digest back
  // into the committed file, which is the line that conflicted in 85 of 98 absorptions.
  it('REFUSES ccd/ccd, whose stamp is written at install time, and leaves it untouched', () => {
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    const committed = readFileSync(CCD, 'utf8');
    writeFileSync(f, committed, { mode: 0o755 });
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('is stamped at install time');
    expect(r.stderr).toContain('nothing to restamp');
    expect(readFileSync(f, 'utf8')).toBe(committed);
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

  it('reports a file it cannot OPEN for writing, exit 1; the message says a later failure may leave it partly written', () => {
    // This pins an OPEN-time failure only (mode 0444, EACCES), where nothing was
    // truncated and the file is as it was. The write is in place (truncate, then
    // write — a temp file and rename would be a second writer the model-env scan
    // forbids in ccd/ccrc), so a failure AFTER the truncate (ENOSPC) can leave it
    // partly written: no test can arm that portably, so the message says so.
    if (process.getuid?.() === 0) return;   // root writes through 0444
    const dir = mkTmp('ccrc-restamp-');
    const f = join(dir, 'ccd');
    writeFileSync(f, staleStamped());
    chmodSync(f, 0o444);
    const r = run([f]);
    expect(r.code).toBe(1);
    expect(readFileSync(f, 'utf8'), 'an open-time failure leaves the file as it was').toBe(staleStamped());
    expect(r.stderr, 'the exit-1 message must not promise the file is untouched').toContain('may be partly written');
    expect(r.stderr).toContain(`git checkout -- ${f}`);
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

  // ARCH-74 (#809): the session hook's generated helpers are regenerated by this
  // same verb, not by a second command.
  describe('the session hook\'s generated helpers', () => {
    const HOOK = path.resolve(here, '..', '..', 'ccd', 'session-hook.sh');
    const shipped = readFileSync(HOOK, 'utf8');

    const ROOT = path.resolve(here, '..', '..');
    /** A fixture tree holding the target hook's own ccd/ and shared/. */
    const tree = (idMax?: number): string => {
      const t = mkTmp('ccrc-restamp-hook-');
      mkdirSync(join(t, 'ccd')); mkdirSync(join(t, 'shared'));
      copyFileSync(CCD, join(t, 'ccd', path.basename(CCD)));
      copyFileSync(join(ROOT, 'shared', 'mark.mjs'), join(t, 'shared', 'mark.mjs'));
      const mod = readFileSync(join(ROOT, 'shared', 'hook-helpers.mjs'), 'utf8');
      writeFileSync(join(t, 'shared', 'hook-helpers.mjs'),
        idMax === undefined ? mod : mod.replace('CCRC_ID_MAX: 128', `CCRC_ID_MAX: ${idMax}`));
      return t;
    };

    it('regenerates a hook whose stamp line is conflicted or whose region was hand-edited', () => {
      const f = join(tree(), 'ccd', 'session-hook.sh');
      writeFileSync(f, shipped.replace(/^# ccrc:generated .*$/m, '# ccrc:generated 1 sha256=0000').replace('CCRC_ID_MAX=128', 'CCRC_ID_MAX=1'));
      const r = run([f]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain('hook helpers regenerated');
      expect(readFileSync(f, 'utf8')).toBe(shipped);
    });

    it('leaves a current hook byte-identical and says so', () => {
      const f = join(tree(), 'ccd', 'session-hook.sh');
      writeFileSync(f, shipped);
      const r = run([f]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain('hook helpers already current');
      expect(readFileSync(f, 'utf8')).toBe(shipped);
    });

    it("takes the module and ccd from the TARGET's tree, not the tree the ccrc script lives in", () => {
      const t = tree(200); // widened in the target tree only; CCRC (this checkout) still says 128
      const f = join(t, 'ccd', 'session-hook.sh');
      writeFileSync(f, shipped);
      const r = run([f]);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toContain('hook helpers regenerated');
      expect(readFileSync(f, 'utf8')).toContain('CCRC_ID_MAX=200');
    });

    it('refuses, writing nothing, a hook whose own tree lacks the module or ccd', () => {
      const f = join(mkTmp('ccrc-restamp-hook-'), 'session-hook.sh');
      writeFileSync(f, shipped);
      const r = run([f]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('Nothing was written');
      expect(readFileSync(f, 'utf8')).toBe(shipped);
    });

    it('REFUSES, naming the damage and writing nothing, a hook whose region lost its END line', () => {
      const f = join(tree(), 'ccd', 'session-hook.sh');
      const damaged = shipped.replace(/^# ── END GENERATED HOOK HELPERS ──\n/m, '');
      expect(damaged).not.toBe(shipped);
      writeFileSync(f, damaged);
      const r = run([f]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('hook helpers refused (missing)');
      expect(readFileSync(f, 'utf8')).toBe(damaged);
    });

    it('REFUSES a hook with no region, untouched', () => {
      const f = join(mkTmp('ccrc-restamp-hook-'), 'session-hook.sh');
      const bare = '#!/usr/bin/env bash\necho hook\n';
      writeFileSync(f, bare);
      const r = run([f]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('no ccrc:generated marker');
      expect(readFileSync(f, 'utf8')).toBe(bare);
    });
  });
});
