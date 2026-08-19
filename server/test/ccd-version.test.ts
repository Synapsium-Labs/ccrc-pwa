// `ccd version` — the fleet host's half of build identity (stage 1). The
// stamp is deploy.sh's ~/.ccrc/build.json; an unstamped HOME (dev checkout)
// gets an honest "unstamped", exit 0 — not an invented version and not an
// error. Harness: the ccd-forget.test.ts dispatcher pattern, verbatim.
//
// Stage 2e Task 5: `cmd_version` used to fold four distinct faults — python3
// missing, a permission-denied stamp, a directory sitting at the stamp path,
// and a stamp that parses but does not type-check — into one collapsed
// `build stamp unreadable`. It now makes the same condition split
// `ccd/ccrc`'s `_box_build_fields` makes (that function's own header gives
// the full rationale); the four cases below pin the split IN cmd_version.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-version-'); });
afterEach(() => { h.cleanup(); });

const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  try {
    return {
      code: 0, stderr: '',
      stdout: execFileSync('bash', [CCD, ...args], {
        encoding: 'utf8', cwd: h.home,
        env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true }),
      }),
    };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** `command -v <name>` under THIS process's real environment — used only to
 *  resolve real binaries to symlink into the curated PATH below, never to run
 *  ccd itself. */
const which = (name: string): string => execFileSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8' }).trim();

/** A PATH holding ONLY `bash` and `mkdir` (symlinks to this box's real
 *  binaries) — genuinely absent python3, not merely shadowed. A shell
 *  FUNCTION named `python3` would still answer `command -v python3`, so the
 *  only way to make cmd_version's own `command -v python3` probe fail
 *  honestly is to keep python3 off PATH entirely (the `ccd-ws-audit.test.ts`
 *  / `ccd-ws-reap.test.ts` `python3() { … }` idiom simulates a different
 *  fault — "present but not runnable via -c" — not absence).
 *
 *  `bash` is included so the curated directory can resolve the interpreter
 *  ccd itself needs to run under; `mkdir` because `ccd/ccd`'s top level runs
 *  `mkdir -p "$REG"` unconditionally, before any verb dispatches. `id` is
 *  avoided rather than symlinked — the harness presets XDG_RUNTIME_DIR /
 *  DBUS_SESSION_BUS_ADDRESS below so ccd's `${XDG_RUNTIME_DIR:=...$(id -u)}`
 *  default never evaluates its command substitution. */
function pathWithoutPython3(home: string): string {
  const dir = path.join(home, 'no-python3-bin');
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['bash', 'mkdir']) fs.symlinkSync(which(name), path.join(dir, name));
  return dir;
}

const runCcdNoPython3 = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const env = ghContainedEnv(h.home, { HOME: h.home, PATH: pathWithoutPython3(h.home) }, { systemd: true });
  // ccd's own default (`: "${XDG_RUNTIME_DIR:=/run/user/$(id -u)}"`) would
  // otherwise need `id`, which the curated PATH above deliberately omits.
  env['XDG_RUNTIME_DIR'] = '/tmp';
  env['DBUS_SESSION_BUS_ADDRESS'] = 'unix:path=/tmp/ccd-version-test-bus';
  try {
    return { code: 0, stderr: '', stdout: execFileSync('bash', [CCD, ...args], { encoding: 'utf8', cwd: h.home, env }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

describe('ccd version', () => {
  it('routes, takes no argv, and advertises itself in caps', () => {
    const r = runCcd('version', 'extra');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('usage: ccd version');
    expect(runCcd('caps').stdout.split('\n')).toContain('version');
  });

  it('prints the stamp when the box was deployed', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'c'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false,
    }));
    const r = runCcd('version');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('c'.repeat(40));
    expect(r.stdout).toContain('main');
    expect(r.stdout).toContain('2026-08-11T11:00:00Z');
    expect(r.stdout).not.toContain('dirty');
  });

  it('a dirty stamp says dirty — a working-tree deploy cannot masquerade', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'd'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: true,
    }));
    expect(runCcd('version').stdout).toContain('dirty');
  });

  it('an unstamped HOME answers honestly, exit 0', () => {
    const r = runCcd('version');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('unstamped');
  });

  it('a corrupt stamp is named, not parsed around', () => {
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), '{torn');
    const r = runCcd('version');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('unreadable');
  });

  it('python3 absent from PATH: the die names python3, not the stamp', () => {
    // Round-1 review of ccrc's own version verb (Important 3, mirrored here):
    // "python3 not on PATH", "the stamp is corrupt" and every other fault used
    // to fall through to the same "build stamp unreadable", which sends an
    // operator to redeploy when the actual fix is `apt install python3`. A
    // real, parseable stamp is present here — the ONLY thing wrong is the
    // interpreter — so the die must name python3, and must NOT say
    // "unreadable" (that word means "the stamp itself is the problem").
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'e'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false,
    }));
    const r = runCcdNoPython3('version');
    expect(r.code, `stderr:\n${r.stderr}`).not.toBe(0);
    expect(r.stderr).toContain('python3');
    expect(r.stderr).not.toContain('unreadable');
  });

  it.skipIf(process.getuid?.() === 0)('a stamp chmod 000 refuses BY NAME — permission, not garbage', () => {
    // root reads anything, so a 0o000 file is not unreadable to it — the
    // `ccd-rc-flag.test.ts` / `coord-token.test.ts` idiom.
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    const stamp = path.join(h.home, '.ccrc', 'build.json');
    fs.writeFileSync(stamp, JSON.stringify({
      sha: 'f'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: false,
    }));
    fs.chmodSync(stamp, 0o000);
    try {
      const r = runCcd('version');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('permission');
    } finally {
      // Restore — the tmpdir cleanup has to be able to unlink it.
      fs.chmodSync(stamp, 0o600);
    }
  });

  it('a DIRECTORY at the stamp path is "not a regular file", not falsely "unstamped"', () => {
    // Today: `[[ ! -f "$stamp" ]]` reads a directory the same as an absent
    // file, so a half-finished rsync/mkdir race silently answers "unstamped,
    // exit 0" instead of naming the shape problem — exactly the collapse
    // `_box_build_fields:299-300` (ccd/ccrc) already refuses to make.
    fs.mkdirSync(path.join(h.home, '.ccrc', 'build.json'), { recursive: true });
    const r = runCcd('version');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('not a regular file');
    expect(r.stdout).not.toContain('unstamped');
  });

  it('"dirty": "false" (a string, not a boolean) refuses rather than printing a lying version', () => {
    // ccrc's rationale (ccd/ccrc:240-245): `dirty` is a real boolean that is
    // legitimately `false` on a clean build, so the reader must check its
    // TYPE, not merely its presence — the same type check also catches a
    // string here, which Python's plain `if dirty:` truthiness would
    // misreport as dirty (a non-empty string is truthy) even though the text
    // says "false".
    fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
    fs.writeFileSync(path.join(h.home, '.ccrc', 'build.json'), JSON.stringify({
      sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-08-11T11:00:00Z', dirty: 'false',
    }));
    const r = runCcd('version');
    expect(r.code, `stdout:\n${r.stdout}`).not.toBe(0);
    expect(r.stdout).toBe('');
  });
});
