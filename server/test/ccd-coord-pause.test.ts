// `ccd coord-pause --state on|off` — the ONE file that stops a program
// mid-flight (`$REG/coordinator-paused`) finally gets a writer on the box.
//
// Why this is a ccd verb at all, restated where it is tested: the server may
// write only `~/.cc-clips` on the fleet host (`agent/src/whitelist.ts`) and
// `FleetIO` has no unlink, so raising or clearing a registry marker from
// the server box is not a mutation that exists server-side. `ws-hold`/`ws-release`
// were granted for the same reason and with the same argument, and this file is
// `ccd-hold.test.ts`'s shape for the same class of verb.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`), never
// the live one: `$REG` is `$HOME/.cc-sessions`, so a test that wrote the real
// marker would pause the actual fleet.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-coord-pause-'); });
afterEach(() => { h.cleanup(); });

/** `stdout` is captured beside `stderr` for `ccd-hold.test.ts`'s reason: on
 *  this verb the defect that matters is a refusal that STILL printed `paused`,
 *  and a code+stderr-only helper cannot see it. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** The dispatcher, not the function — `ccd-archive.test.ts`'s `runCcd`. The
 *  agent invokes this verb as `ccd coord-pause --state on`, so the `case` arm
 *  is load-bearing production surface: a shipped `cmd_coord_pause` with no arm
 *  answers the usage line at exit 1 for every tap the phone makes. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

const REG = (): string => path.join(h.home, '.cc-sessions');
const marker = (): string => path.join(REG(), 'coordinator-paused');

describe('ccd coord-pause', () => {
  it('creates $REG/coordinator-paused with --state on, and says paused', () => {
    expect(h.sh('cmd_coord_pause --state on')).toBe('paused');
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('is idempotent: twice on leaves one marker and one answer', () => {
    expect(h.sh('cmd_coord_pause --state on')).toBe('paused');
    expect(h.sh('cmd_coord_pause --state on')).toBe('paused');
    expect(fs.existsSync(marker())).toBe(true);
    // One file, not two, and not a directory that `-e` would still match.
    expect(fs.statSync(marker()).isFile()).toBe(true);
  });

  it('removes it with --state off, and says running', () => {
    h.sh('cmd_coord_pause --state on');
    expect(h.sh('cmd_coord_pause --state off')).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('is idempotent off: off with no marker still says running, exit 0', () => {
    // The level re-arms itself — `cmd_ws_release`'s idempotence, with the
    // difference that there is no second word to say here: an unpaused fleet
    // and a just-unpaused fleet are the same state, and the caller asked for
    // that state, not for a diff.
    expect(fs.existsSync(marker())).toBe(false);
    expect(h.sh('cmd_coord_pause --state off')).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('refuses a missing, an extra, and a non-on|off argument — each by its own sentence', () => {
    for (const argv of ['', '--state', 'on', '--state on extra', '--flag on']) {
      const r = shFail(`cmd_coord_pause ${argv}`);
      expect(r.code, `argv: ${argv}`).not.toBe(0);
      expect(r.stderr, `argv: ${argv}`).toContain('usage: ccd coord-pause --state on|off');
    }
    // A state that is not on|off is a DIFFERENT refusal from a malformed argv:
    // the caller got the shape right and the vocabulary wrong, and folding the
    // two would answer "usage" to someone whose usage was fine.
    const bad = shFail('cmd_coord_pause --state maybe');
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('bad state: maybe');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('refuses when $REG is not a directory — the marker has nowhere to live', () => {
    // Deleting the directory does NOT produce this state: ccd runs
    // `mkdir -p "$REG"` at source time (ccd:41), so it is back before any verb
    // runs. A FILE at the path is the state the guard actually answers — that
    // `mkdir -p` is unchecked, so it fails silently and leaves `-d` false — and
    // it discriminates for any uid, root included.
    fs.rmSync(REG(), { recursive: true, force: true });
    fs.writeFileSync(REG(), 'not a directory\n');
    const r = shFail('cmd_coord_pause --state on');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no registry');
    expect(r.stdout).not.toContain('paused');
  });

  // `chmod 500` does not discriminate as root — root writes through any mode
  // bit — and unlike the unlink arm below there is no root-proof stand-in:
  // `touch` on a DIRECTORY at the marker path SUCCEEDS (it stamps the
  // directory's mtime), so the directory trick that pins the `rm` guard cannot
  // pin this one. Guarded rather than silently passing for the wrong reason,
  // the idiom `coord-token.test.ts` and `ccd-prhistory.test.ts` already use.
  it.skipIf(process.getuid?.() === 0)(
    'refuses LOUDLY when the marker cannot be written — never a false success', () => {
      // ccd runs `set -uo pipefail` with NO `-e`. Unguarded, a failed `touch`
      // falls straight through to the `echo`, and the caller — a route that
      // keys on the exit code — is told the FLEET IS STOPPED while dispatch
      // keeps handing out work. That polarity is why this verb checks both
      // arms; it is the one where a false success is worse than a refusal.
      fs.chmodSync(REG(), 0o500);
      try {
        const r = shFail('cmd_coord_pause --state on');
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('NOT paused');
        expect(r.stdout).not.toContain('paused');
        expect(fs.existsSync(marker())).toBe(false);
      } finally {
        fs.chmodSync(REG(), 0o700); // the harness's recursive rm needs to write here
      }
    });

  it('refuses LOUDLY when the marker cannot be removed — it is STILL paused', () => {
    // `rm -f` suppresses ENOENT only; EISDIR and EACCES still exit non-zero.
    // A directory at the path fails for ANY uid, root included, and it is a
    // real state in its own right: `-e` matches it, so the emitter that lists
    // `$REG` already reads the fleet as paused.
    fs.mkdirSync(marker());
    const r = shFail('cmd_coord_pause --state off');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('STILL paused');
    expect(r.stdout).not.toContain('running');
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('appears in ccd caps', () => {
    // `~/.local/bin/ccd` is a COPY, so the route's `verbSupported` check is the
    // only thing standing between an old box and a silent no-op: a verb that
    // works but is not advertised answers 501 for every tap.
    expect(h.sh('cmd_caps').split('\n')).toContain('coord-pause');
  });

  it('is reachable through the dispatcher, with argv shifted', () => {
    const on = runCcd('coord-pause', '--state', 'on');
    expect(on.code).toBe(0);
    expect(on.stdout).toBe('paused');
    expect(fs.existsSync(marker())).toBe(true);

    const off = runCcd('coord-pause', '--state', 'off');
    expect(off.code).toBe(0);
    expect(off.stdout).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);

    // And the verb is named in the usage line the dispatcher's `*` arm prints,
    // which is the only place a human reading `ccd` with no argv learns it
    // exists.
    const usage = runCcd('no-such-verb');
    expect(usage.code).not.toBe(0);
    expect(usage.stderr).toContain('coord-pause');
  });

  it('touches nothing else in $REG', () => {
    // The marker is the whole effect. A verb that also stamped, say, a
    // `.hold` or a lock file would be a second fact for the fleet lane to
    // read, and the banner's clock is `$REG`'s listing.
    h.sh('cmd_coord_pause --state on');
    const before = fs.readdirSync(REG()).sort();
    expect(before).toEqual(['coordinator-paused']);
    h.sh('cmd_coord_pause --state off');
    expect(fs.readdirSync(REG())).toEqual([]);
  });
});
