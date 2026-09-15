// `ccd win-size --session <id> --mode smallest|canonical` — the fleet-control
// verb the terminal drawer un-pins a session's tmux window through (spec §6.1).
//
// Why a ccd verb and not a tmux grant: the un-pin is `set-option -t <s>
// window-size smallest`, and `agent/src/whitelist.ts` grants tmux exactly five
// verbs, `set-option` not among them. A `['tmux','set-option']` prefix would
// permit setting ANY tmux option on any target, because prefix matching leaves
// every later token unconstrained. Wrapping the one option in a ccd verb keeps
// the grant two tokens wide and puts the validation on the box.
//
// Everything runs against the isolated fixture HOME (`makeCcdHarness`) with a
// bash `tmux()` function stub that RECORDS instead of running — the harness's
// own PATH poison cannot answer `has-session`, and an uncontained tmux call
// would reach the operator's LIVE server.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-win-size-'); });
afterEach(() => { h.cleanup(); });

/** A tmux that records every argv and succeeds. `has-session` must succeed too,
 *  or every case would stop at the liveness refusal. */
const TMUX_OK = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };';
/** The same recorder, refusing — the shape a vanished session or a tmux that
 *  cannot answer produces. */
const TMUX_FAIL = 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 1; };';
/** Alive, but the mutation itself fails: `has-session` 0, everything else 1. */
const TMUX_MUTATE_FAIL =
  'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 0 ;; *) return 1 ;; esac; };';

/** The liveness probe every successful path runs first, spelled once so the
 *  whole-sequence pins below read as "the probe, then exactly one mutation". */
const PROBE = 'tmux has-session -t cc-demo-quiet-basin';

const shFail = (snippet: string): { code: number; stderr: string; stdout: string } => {
  try { return { code: 0, stderr: '', stdout: h.sh(snippet) }; }
  catch (e) {
    const err = e as { status?: number; stderr?: Buffer; stdout?: Buffer };
    return { code: err.status ?? 1, stderr: String(err.stderr ?? ''), stdout: String(err.stdout ?? '') };
  }
};

/** The dispatcher, not the function — the agent invokes `ccd win-size …`, so
 *  the `case` arm is production surface (`ccd-coord-pause.test.ts`'s runCcd). */
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

const calls = (): string[] => {
  const p = path.join(h.home, 'ccd-calls');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : [];
};

describe('ccd win-size', () => {
  it('smallest UN-LATCHES the window, scoped to this session only', () => {
    expect(h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode smallest`)).toBe('smallest');
    expect(calls()).toContain('tmux set-option -t cc-demo-quiet-basin window-size smallest');
    // NEVER `latest`: F4 measured a keystroke-driven reflow flip at +6 MB RSS
    // per flip, shedding 50 history lines per flip from about flip 17.
    expect(calls().join('\n')).not.toContain('window-size latest');
    // NEVER GLOBAL. `set-option` with no `-t` writes the server-wide default and
    // resizes all ~20 live sessions at once.
    for (const c of calls()) {
      if (c.includes('set-option')) expect(c).toContain('-t cc-demo-quiet-basin');
    }
    // THE WHOLE SEQUENCE, not a membership check, and this is the assertion
    // that refuses a WRONG implementation rather than only a missing one: a
    // `smallest` arm that un-pins and then re-pins — `set-option … smallest`
    // followed by `resize-window … -x 220 -y 50`, which leaves the window
    // exactly as pinned as it found it while answering `smallest` — satisfies
    // every membership assertion above and defeats the entire verb. Only an
    // exact sequence can see it.
    expect(calls()).toEqual([PROBE, 'tmux set-option -t cc-demo-quiet-basin window-size smallest']);
  });

  it('canonical re-pins the grid ccd spawns with, and re-latches manual', () => {
    expect(h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode canonical`)).toBe('canonical');
    expect(calls()).toContain('tmux resize-window -t cc-demo-quiet-basin -x 220 -y 50');
    // `resize-window` is what latches `manual` (F3) — an arm that used
    // `set-option window-size manual` would latch the option without setting
    // the size, leaving the window wherever the last client left it.
    expect(calls().join('\n')).not.toContain('window-size manual');
    // The same whole-sequence pin as the `smallest` case, for the mirror-image
    // wrong implementation: an arm that re-pins and ALSO leaves the option
    // un-latched (or issues any second, unreviewed mutation) passes the two
    // assertions above and is invisible to them.
    expect(calls()).toEqual([PROBE, 'tmux resize-window -t cc-demo-quiet-basin -x 220 -y 50']);
  });

  it('refuses a malformed argv by its own sentence, and runs nothing', () => {
    for (const argv of [
      '', '--session demo', '--session demo --mode', '--mode smallest',
      '--session demo --mode smallest extra', '--sess demo --mode smallest',
      '--session demo --style smallest',
    ]) {
      const r = shFail(`${TMUX_OK} cmd_win_size ${argv}`);
      expect(r.code, `argv: ${argv}`).not.toBe(0);
      expect(r.stderr, `argv: ${argv}`)
        .toContain('usage: ccd win-size --session <id> --mode smallest|canonical');
    }
    expect(calls(), 'a refused argv must run no tmux at all').toEqual([]);
  });

  it('refuses an id outside ccd\'s own id class BEFORE any target is built from it', () => {
    // The roster's ID_RE (`shared/roster.ts`), which is `cmd_account_pane`'s
    // precedent and the class spec §6.1 names — not the looser
    // `^[A-Za-z0-9._-]+$` most workspace verbs use. The id is about to be
    // interpolated into a tmux target, so the gate runs first.
    for (const id of ['', '-leading', '1leading', 'Upper', 'has space', '../escape',
                      'semi;colon', 'dollar$sign', 'a'.repeat(33)]) {
      const r = shFail(`${TMUX_OK} cmd_win_size --session '${id}' --mode smallest`);
      expect(r.code, `id: ${id}`).not.toBe(0);
      expect(r.stderr, `id: ${id}`).toContain('bad id:');
    }
    expect(calls(), 'a refused id must run no tmux at all').toEqual([]);
  });

  it('accepts the id class it is supposed to accept — the refusal above is not a blanket one', () => {
    // The control for the refusal case: nine ids in, nine refusals out proves a
    // gate fires, NOT that it fires on the right class — `[[ 1 == 2 ]] || die`
    // reds nothing above and refuses every id there is. These four are ID_RE's
    // own edges (bare letter, digits and hyphens, and exactly 32 characters,
    // the longest the `{0,31}` tail admits) and they must all reach tmux.
    for (const id of ['a', 'demo-quiet-basin', 'cc9-x-2', `a${'b'.repeat(31)}`]) {
      expect(h.sh(`${TMUX_OK} cmd_win_size --session '${id}' --mode smallest`)).toBe('smallest');
      expect(calls(), `id: ${id}`).toContain(`tmux set-option -t cc-${id} window-size smallest`);
    }
  });

  it('refuses an unknown mode with a DIFFERENT sentence, and runs nothing', () => {
    // A caller who got the shape right and the vocabulary wrong is not a caller
    // who got the usage wrong — folding the two answers "usage" to someone
    // whose usage was fine (`cmd_coord_pause`'s bad-state precedent).
    const r = shFail(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode latest`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('bad mode: latest (want smallest|canonical)');
    expect(r.stderr).not.toContain('usage: ccd win-size');
    expect(calls(), 'an unknown mode must run no tmux at all').toEqual([]);
  });

  it('refuses an absent session, and mutates nothing', () => {
    const r = shFail(`${TMUX_FAIL} cmd_win_size --session demo-quiet-basin --mode smallest`);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no such session: cc-demo-quiet-basin');
    expect(r.stdout).not.toContain('smallest');
    expect(calls(), 'only the liveness probe ran').toEqual([PROBE]);
  });

  it('refuses LOUDLY when the mutation itself fails — never a false success', () => {
    // ccd runs `set -uo pipefail` with NO `-e`: unguarded, a failed `set-option`
    // falls straight through to the `echo` and the caller — wave 3's route,
    // which keys on the exit code — is told the window is FOLLOWING when it is
    // still pinned, and un-pins nothing while reporting that it did.
    const un = shFail(`${TMUX_MUTATE_FAIL} cmd_win_size --session demo-quiet-basin --mode smallest`);
    expect(un.code).not.toBe(0);
    expect(un.stderr).toContain('STILL at its pinned size');
    expect(un.stdout).not.toContain('smallest');

    const pin = shFail(`${TMUX_MUTATE_FAIL} cmd_win_size --session demo-quiet-basin --mode canonical`);
    expect(pin.code).not.toBe(0);
    expect(pin.stderr).toContain('NOT at the canonical grid');
    expect(pin.stdout).not.toContain('canonical');
  });

  it('advertises BOTH the verb and its capability token in ccd caps', () => {
    // Two mechanisms, two lines. The VERB name is what `verbSupported` and the
    // dispatcher parity check read; the TOKEN is what wave 3's
    // `capSupported(state,'win-size-v1')` reads, and it is the proof of BOTH
    // halves of this wave — the verb and the readers' stand-down ship in one
    // ccd inode, so a server that sees the token knows the readers yield.
    const advertised = h.sh('cmd_caps').split('\n');
    expect(advertised).toContain('win-size');
    expect(advertised).toContain('win-size-v1');
  });

  it('is reachable through the dispatcher, with argv shifted, and is named in the usage line', () => {
    // The harness's PATH tmux poison exits 97, so the dispatcher path lands on
    // the liveness refusal — which is exactly what proves the `case` arm runs:
    // a missing arm answers the `*)` usage line instead.
    const r = runCcd('win-size', '--session', 'demo-quiet-basin', '--mode', 'smallest');
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('no such session: cc-demo-quiet-basin');
    expect(r.stderr).not.toContain('usage: ccd {start|');

    const usage = runCcd('no-such-verb');
    expect(usage.code).not.toBe(0);
    expect(usage.stderr).toContain('win-size');
  });

  it('touches nothing in $REG — the window is the whole effect', () => {
    // Unlike `coord-pause`, this verb writes no marker. A registry file here
    // would be a second fact for the fleet lane to read.
    h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode smallest`);
    expect(fs.readdirSync(path.join(h.home, '.cc-sessions'))).toEqual([]);
  });
});
