// `ccd reclaim-pause --state on|off` — the writer of `$REG/reclaim-paused`, the
// fleet-wide kill-switch on the AUTOMATIC reclamation of child workspaces
// (child-reclamation spec §5.8). A copy of `ccd coord-pause` in every respect,
// and this file is `ccd-coord-pause.test.ts`'s shape for the same reason that
// file is `ccd-hold.test.ts`'s: the server may write only `~/.cc-clips` on the
// fleet host and `FleetIO` has no unlink, so a registry marker is raised and
// cleared through a ccd verb or not at all.
//
// The one case with no coord-pause twin is the LAST one: a switch is only a
// switch if the verb that deletes reads it. Wave 3's `ws-reclaim` reads this
// file at its rung 3 and again on resume; the scan below holds the writer's
// path to one spelling, and a second assertion holds the exact reader
// expression to that same spelling inside EACH of wave 3's two eval
// functions, so neither the writer nor either reader can move alone.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`), never
// the live one: `$REG` is `$HOME/.cc-sessions`, so a test that wrote the real
// marker would stop the real fleet's reclamation.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-child-reclaim-pause-'); });
afterEach(() => { h.cleanup(); });

/** stdout BESIDE stderr and the code: on this verb the defect that matters is
 *  a refusal that STILL printed `paused`. */
const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** The dispatcher, not the function — the agent runs `ccd reclaim-pause --state on`,
 *  so the `case` arm is production surface. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

const REG = (): string => path.join(h.home, '.cc-sessions');
const marker = (): string => path.join(REG(), 'reclaim-paused');

describe('ccd reclaim-pause', () => {
  it('creates $REG/reclaim-paused with --state on, and says paused', () => {
    expect(h.sh('cmd_reclaim_pause --state on')).toBe('paused');
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('is idempotent: twice on leaves one marker and one answer', () => {
    expect(h.sh('cmd_reclaim_pause --state on')).toBe('paused');
    expect(h.sh('cmd_reclaim_pause --state on')).toBe('paused');
    expect(fs.statSync(marker()).isFile()).toBe(true);
  });

  it('removes it with --state off, and says running', () => {
    h.sh('cmd_reclaim_pause --state on');
    expect(h.sh('cmd_reclaim_pause --state off')).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('is idempotent off: off with no marker still says running, exit 0', () => {
    expect(fs.existsSync(marker())).toBe(false);
    expect(h.sh('cmd_reclaim_pause --state off')).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('refuses a malformed argv by the usage line, and a bad state by its OWN sentence', () => {
    for (const argv of ['', '--state', 'on', '--state on extra', '--flag on']) {
      const r = shFail(`cmd_reclaim_pause ${argv}`);
      expect(r.code, `argv: ${argv}`).not.toBe(0);
      expect(r.stderr, `argv: ${argv}`).toContain('usage: ccd reclaim-pause --state on|off');
    }
    // The shape was right and the word was wrong: a different refusal, so
    // "usage" is never answered to a caller whose usage was fine.
    const bad = shFail('cmd_reclaim_pause --state maybe');
    expect(bad.code).not.toBe(0);
    expect(bad.stderr).toContain('bad state: maybe (want on|off)');
    expect(bad.stderr).not.toContain('usage: ccd reclaim-pause');
    expect(bad.stdout).not.toContain('running');
    expect(fs.existsSync(marker())).toBe(false);
  });

  it('refuses when $REG is not a directory — the marker has nowhere to live', () => {
    // A FILE at the path is the state the guard answers: ccd's source-time
    // `mkdir -p "$REG"` is unchecked, so it fails silently and leaves `-d`
    // false. Discriminates for any uid, root included.
    fs.rmSync(REG(), { recursive: true, force: true });
    fs.writeFileSync(REG(), 'not a directory\n');
    const r = shFail('cmd_reclaim_pause --state on');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no registry');
    expect(r.stdout).not.toContain('paused');
  });

  // Root writes through any mode bit, and `touch` on a DIRECTORY at the path
  // succeeds, so this arm has no root-proof stand-in — skipped as root rather
  // than passing for the wrong reason (`ccd-coord-pause.test.ts`'s idiom).
  it.skipIf(process.getuid?.() === 0)(
    'refuses LOUDLY when the marker cannot be written — never a false "paused"', () => {
      // `set -uo pipefail` with NO `-e`: an unguarded failed `touch` falls
      // through to the echo, and the phone is told reclamation STOPPED while
      // the sweep keeps deleting. The one polarity that must never be false.
      fs.chmodSync(REG(), 0o500);
      try {
        const r = shFail('cmd_reclaim_pause --state on');
        expect(r.code).not.toBe(0);
        expect(r.stderr).toContain('reclamation is NOT paused');
        expect(r.stdout).not.toContain('paused');
        expect(fs.existsSync(marker())).toBe(false);
      } finally {
        fs.chmodSync(REG(), 0o700);
      }
    });

  // A DANGLING link at the marker's name reads as paused on every reader —
  // the server lists the name, and `ws-reclaim` tests `-e || -L` — so `off`
  // must remove it too, or the phone's toggle could never settle.
  it('removes a DANGLING link at the marker with --state off, and says running', () => {
    fs.symlinkSync(path.join(h.home, 'nowhere'), marker());
    expect(fs.lstatSync(marker()).isSymbolicLink()).toBe(true);
    expect(h.sh('cmd_reclaim_pause --state off')).toBe('running');
    expect(() => fs.lstatSync(marker())).toThrow(/ENOENT/);
  });

  it('refuses LOUDLY when the marker cannot be removed — reclamation is STILL paused', () => {
    // `rm -f` suppresses ENOENT only. A directory at the path fails for any uid.
    fs.mkdirSync(marker());
    const r = shFail('cmd_reclaim_pause --state off');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('reclamation is STILL paused');
    expect(r.stdout).not.toContain('running');
    expect(fs.existsSync(marker())).toBe(true);
  });

  it('advertises BOTH the verb and its capability token in ccd caps', () => {
    // The VERB is what the dispatcher-parity check reads; the TOKEN is what the
    // server's `capSupported(state, RECLAIM_PAUSE_CAP)` reads — null REFUSES, so
    // a box without this ccd answers the phone 501 rather than a usage error.
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('reclaim-pause');
    expect(advertised).toContain('reclaim-pause-v1');
  });

  it('is reachable through the dispatcher, with argv shifted, and is named in the usage line', () => {
    const on = runCcd('reclaim-pause', '--state', 'on');
    expect(on.code).toBe(0);
    expect(on.stdout).toBe('paused');
    expect(fs.existsSync(marker())).toBe(true);

    const off = runCcd('reclaim-pause', '--state', 'off');
    expect(off.code).toBe(0);
    expect(off.stdout).toBe('running');
    expect(fs.existsSync(marker())).toBe(false);

    const usage = runCcd('no-such-verb');
    expect(usage.code).not.toBe(0);
    expect(usage.stderr).toContain('|reclaim-pause|');
  });

  it("touches nothing else in $REG — and never the coordinator's own marker", () => {
    // Two switches, two files. A reclaim pause that also paused dispatch — or a
    // coordinator pause that silently stopped reclamation — would be one
    // operator act with two effects nobody asked for.
    h.sh('cmd_reclaim_pause --state on');
    expect(fs.readdirSync(REG()).sort()).toEqual(['reclaim-paused']);
    h.sh('cmd_coord_pause --state on');
    h.sh('cmd_reclaim_pause --state off');
    expect(fs.readdirSync(REG()).sort()).toEqual(['coordinator-paused']);
  });

  it('writes the SAME path ws-reclaim reads — one marker, one spelling, two verbs', () => {
    // Spec §5.8: "`ws-reclaim` itself reads it — in the eval ladder and again on
    // resume — because a gate evaluated only by the server fails open into
    // deletion." That reader is wave 3's; this verb is its only writer. A path
    // typo on either side leaves a toggle that works, a frame that reports it,
    // and a deleting verb that never sees it — every suite green. So: every
    // NON-COMMENT line of ccd that names the file spells it as a `$REG` path
    // (`$REG/`, `${REG}/`, `"$REG"/` or `"${REG}"/` — one path, four bash
    // spellings), exactly one of them is inside the writer, and at least one is
    // outside it. Task 1 Step 2 ran this exact filter over wave 3's lines first.
    const src = fs.readFileSync(CCD, 'utf8').split('\n');
    const start = src.findIndex((l) => l.startsWith('cmd_reclaim_pause() {'));
    expect(start, 'cmd_reclaim_pause is not defined at column 0').toBeGreaterThan(-1);
    const end = src.findIndex((l, i) => i > start && l === '}');
    expect(end, 'cmd_reclaim_pause has no closing brace at column 0').toBeGreaterThan(start);
    const code = src
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !/^\s*#/.test(l) && l.includes('reclaim-paused'));
    for (const { l, i } of code) {
      expect(l, `ccd/ccd:${i + 1} names the file without $REG/`)
        .toMatch(/(\$REG|\$\{REG\}|"\$REG"|"\$\{REG\}")\/reclaim-paused\b/);
    }
    const inside = code.filter(({ i }) => i > start && i < end);
    const outside = code.filter(({ i }) => i < start || i > end);
    expect(inside.length, 'the writer names the path exactly once').toBe(1);
    expect(outside.length, "ws-reclaim's reader (wave 3) — a switch no deleting verb reads is wired to nothing")
      .toBeGreaterThanOrEqual(1);
    // The scan above is satisfied by a REFUSAL MESSAGE
    // (`_reap_refuse paused "… ($REG/reclaim-paused)"`), not by a reader — a
    // mistyped TEST expression with its message left alone still names the
    // path once outside the writer, so `outside` stays >= 1. Pin the reader
    // side separately: the exact expression both readers use,
    // `[[ ! -e "$REG/reclaim-paused" && ! -L "$REG/reclaim-paused" ]]` (a
    // dangling link at that name pauses too), must appear inside EACH of wave 3's
    // two eval functions — the fresh arm (`_ws_reclaim_eval`, its rung 3) and
    // the resume arm (`_ws_reclaim_resume_eval`) — sliced by their own
    // `name() {` … `^}`, so mistyping either reader's path reds this suite on
    // its own function, independently of the other and of the writer.
    const READER = /\[\[ ! -e "\$REG\/reclaim-paused" && ! -L "\$REG\/reclaim-paused" \]\]/;
    const sliceFn = (name: string): string[] => {
      const fnStart = src.findIndex((l) => l.startsWith(`${name}() {`));
      expect(fnStart, `${name} is not defined at column 0`).toBeGreaterThan(-1);
      const fnEnd = src.findIndex((l, i) => i > fnStart && l === '}');
      expect(fnEnd, `${name} has no closing brace at column 0`).toBeGreaterThan(fnStart);
      return src.slice(fnStart, fnEnd + 1);
    };
    for (const name of ['_ws_reclaim_eval', '_ws_reclaim_resume_eval']) {
      expect(sliceFn(name).some((l) => READER.test(l)), `${name} does not read $REG/reclaim-paused`).toBe(true);
    }
  });
});
