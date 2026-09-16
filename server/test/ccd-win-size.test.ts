// `ccd win-size --session <id> --mode smallest|canonical` — the fleet-control
// verb the terminal drawer un-pins a session's tmux window through (spec §6.1).
//
// Why a ccd verb and not a tmux grant: the un-pin is `set-option -t <s>
// window-size smallest`, and `agent/src/whitelist.ts` grants tmux exactly five
// verbs, `set-option` not among them. A `['tmux','set-option']` prefix would
// permit setting ANY tmux option on any target, because prefix matching leaves
// every later token unconstrained. Wrapping the one option in a ccd verb keeps
// the GRANT two tokens wide and puts the validation on the box.
//
// WHAT THE TABLE ENFORCES IS THE SPELLING AT `args[0]`, NOT THE CAPABILITY, and
// this header claimed the stronger thing until fix round 2. `isExecAllowed`
// matches a granted prefix and leaves every later token free, and tmux parses a
// bare `;` ARGV ELEMENT as its own command separator with no shell involved.
// Measured 2026-09-16:
//   isExecAllowed('tmux', ['has-session','-t','x',';','set-option','-g',
//                          'window-size','manual'])              -> ALLOW
//   isExecAllowed('tmux', ['set-option','-g','window-size','manual']) -> REFUSE
// and on a private `-L` socket that first argv really does run both commands:
// `show-options -g window-size` went `latest` -> `manual`.
//
// IT IS NOT REACHABLE FROM THE PWA, and that is a property of the CALL
// CONVENTION rather than of the table: every tmux argv in `server/src/exec.ts`
// is a literal token array, and the wire-supplied values land as SINGLE tokens
// (`target(id)` is one token, `sendLiteral`'s text is the one token after
// `-l`). Measured on the same socket: `send-keys -t <s> -l ';'` and
// `send-keys -t <s> -l '; set-option -g window-size manual'` both leave the
// global at `latest`, and a `;` inside a `resize-window -x` value is refused
// `width invalid`. A `;` only separates when it is its own argv element, and
// nothing on the wire can add one. Hardening `isExecAllowed` is deliberately
// NOT this wave's work — it is the single function gating the whole
// PWA→fleet path — so what this file says about it is now what it does.
//
// AND THE VALIDATION IS NOT THE ID CLASS ALONE (D-2780, fix round 1). `-t` is an
// fnmatch PATTERN resolved to a unique match, not a session name, so a perfectly
// well-formed id that names NO session resolves to a DIFFERENT one that exists.
// Every target this verb builds is therefore `=`-anchored; the case below that
// says so is the one that makes "puts the validation on the box" true.
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

// THE THREE ARGVS THIS VERB MAY PRODUCE, spelled once each as literals (never
// derived from `ccd/ccd`, which would make them tautological). Every target is
// `=`-anchored: `=name` is tmux's EXACT-match form, and the trailing `:` is the
// window target the two mutating commands take. See the `anchors EVERY tmux
// target` case for the measurements behind each character.
const PROBE = 'tmux has-session -t =cc-demo-quiet-basin';
const UNPIN = 'tmux set-option -t =cc-demo-quiet-basin: window-size smallest';
const REPIN = 'tmux resize-window -t =cc-demo-quiet-basin: -x 220 -y 50';

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
  it('smallest UN-LATCHES the window, on an EXACT target and this session only', () => {
    expect(h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode smallest`)).toBe('smallest');
    expect(calls()).toContain(UNPIN);
    // NEVER `latest`: F4 measured a keystroke-driven reflow flip at +6 MB RSS
    // per flip, shedding 50 history lines per flip from about flip 17. THAT IS
    // THIS VERB'S RULE, NOT THE FILE'S, and the two are easy to read as one:
    // `_spawn_start` sets `window-size latest` on every session it creates
    // (`ccd/ccd`, one `set-option … window-size latest` inside that function —
    // measured, the only other `window-size` write in the file), and the
    // server's `resize-window` pin overrides it. What is refused here is
    // reaching back for `latest` when UN-pinning.
    expect(calls().join('\n')).not.toContain('window-size latest');
    // ALWAYS `-t`. The reason stated here was that `set-option` with no `-t`
    // "writes the server-wide default and resizes all ~20 live sessions at
    // once". Re-measured 2026-09-16 (tmux 3.4, private `-L` socket, three
    // detached sessions): `tmux set-option window-size smallest` -> rc 0,
    // `show-options -g window-size` STILL `latest`, the two siblings untouched,
    // no session resized. Both halves were wrong. The real hazard is the same
    // class this branch fixed: it mutates ONE WINDOW NOBODY NAMED — whichever
    // session tmux calls current. Anchored, not merely present: a bare
    // `-t cc-demo-quiet-basin` is a PATTERN, so "scoped" would be a claim this
    // assertion could not make before D-2780.
    for (const c of calls()) {
      if (c.includes('set-option')) expect(c).toContain('-t =cc-demo-quiet-basin:');
    }
    // THE WHOLE SEQUENCE, not a membership check, and this is the assertion
    // that refuses a WRONG implementation rather than only a missing one: a
    // `smallest` arm that un-pins and then re-pins — `set-option … smallest`
    // followed by `resize-window … -x 220 -y 50`, which leaves the window
    // exactly as pinned as it found it while answering `smallest` — satisfies
    // every membership assertion above and defeats the entire verb. Only an
    // exact sequence can see it.
    expect(calls()).toEqual([PROBE, UNPIN]);
  });

  it('canonical re-pins the grid ccd spawns with, and latches manual', () => {
    expect(h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode canonical`)).toBe('canonical');
    expect(calls()).toContain(REPIN);
    // `resize-window` is what latches `manual` (F3) — an arm that used
    // `set-option window-size manual` would latch the option without setting
    // the size, leaving the window wherever the last client left it. (`manual`
    // is the SERVER's pinned state being restored, not the state spawn leaves:
    // spawn creates at 220x50 and then sets `latest`.)
    expect(calls().join('\n')).not.toContain('window-size manual');
    // The same whole-sequence pin as the `smallest` case, for the mirror-image
    // wrong implementation: an arm that re-pins and ALSO leaves the option
    // un-latched (or issues any second, unreviewed mutation) passes the two
    // assertions above and is invisible to them.
    expect(calls()).toEqual([PROBE, REPIN]);
  });

  it('anchors EVERY tmux target with `=`, so a validated id that names NO session cannot resolve to one that does', () => {
    // THE DEFECT THIS CLOSES (D-2780), measured on tmux 3.4 over a PRIVATE `-L`
    // socket holding two sessions, `cc-demo-quiet-basin` and `cc-other-session`:
    //   has-session   -t cc-demo                       -> rc 0  (the prefix resolved)
    //   set-option    -t cc-demo window-size smallest  -> rc 0, and show-options
    //                                                    on cc-demo-quiet-basin
    //                                                    then reads `smallest`
    //   resize-window -t cc-demo -x 200 -y 40          -> rc 0, and that REAL
    //                                                    session became 200x40
    //   set-option    -t 'cc-oth*' window-size smallest-> rc 0, cc-other-session
    //                                                    took it (fnmatch, not
    //                                                    merely prefix)
    // `-t` is a PATTERN resolved to a unique match, not a name — live sessions
    // on this fleet share long prefixes and differ only in a final syllable,
    // so an id that names NO session can uniquely prefix a live one.
    // So the liveness refusal below could not fire for such an id, and the verb
    // would mutate a session nobody named.
    //
    // THE REMEDY, measured on the same socket. `=` is tmux's exact-match prefix:
    //   has-session   -t '=cc-demo'                    -> rc 1 can't find session
    //   has-session   -t '=cc-demo-quiet-basin'        -> rc 0
    //   set-option    -t '=cc-demo:'                   -> rc 1 no such window
    //   set-option    -t '=cc-demo-quiet-basin:'       -> rc 0
    //   resize-window -t '=cc-demo:'                   -> rc 1 can't find session
    //   resize-window -t '=cc-demo-quiet-basin:'       -> rc 0
    //   set-option    -t '=cc-oth*:'                   -> rc 1 no such window
    //
    // THE TRAILING `:` IS LOAD-BEARING, NOT COSMETIC. This place said
    // `resize-window` "accepts both" forms and carried the colon for symmetry.
    // That was measured against an EXACT name — where both forms are safe —
    // and it is the one case D-2780 is not about. Re-measured 2026-09-16
    // against a PREFIX, private `-L` socket holding ONLY `cc-demo-quiet-basin`:
    //   resize-window -t '=cc-demo'  -x 199 -y 44 -> rc 0, and
    //                                                cc-demo-quiet-basin
    //                                                BECAME 199x44
    //   resize-window -t '=cc-demo:' -x 177 -y 33 -> rc 1 can't find session
    // For a WINDOW target `=` only binds with the colon present. Drop the colon
    // from the pin arm and D-2780 is LIVE again — a wrong-session resize at
    // rc 0. `has-session` takes a SESSION target and gets no colon; it is the
    // one command for which `=` alone binds.
    h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode smallest`);
    h.sh(`${TMUX_OK} cmd_win_size --session demo-quiet-basin --mode canonical`);
    const targets = calls().map((c) => /\s-t\s(\S+)/.exec(c)?.[1] ?? null);
    // Anti-vacuity: two runs, each a probe plus one mutation. Without this the
    // loop below passes over an empty list if the verb ever stops calling tmux.
    expect(targets, 'two runs must produce four -t targets').toHaveLength(4);
    // PER COMMAND, BECAUSE THE COLON IS NOT OPTIONAL ON THE MUTATING ARMS. A
    // single `/^=cc-demo-quiet-basin:?$/` over all four accepts a colon-less
    // MUTATION target, which is the live D-2780 defect measured above — this
    // case, whose whole declared job is the anchor, could not see it, and only
    // the whole-sequence pins in the two cases above reddened on a colon-less
    // mutant. Split so each arm is held to the form its own tmux command needs.
    for (const c of calls()) {
      const t = /\s-t\s(\S+)/.exec(c)?.[1] ?? null;
      if (c.includes('has-session')) expect(t, c).toMatch(/^=cc-demo-quiet-basin$/);
      else expect(t, c).toMatch(/^=cc-demo-quiet-basin:$/);
    }
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
    //
    // THE SECOND GROUP IS THE POINT (fix round 1). The first nine are SHELL
    // hazards, and nothing here passes through a shell — pinned against those
    // alone the class is only pinned against being NARROWED, which is the
    // direction that cannot hurt anyone: the widened class
    // `^[a-z][a-z0-9.:*?-]{0,31}$` satisfies every one of them. The characters
    // that are load-bearing are TMUX TARGET metacharacters, each measured on a
    // private `-L` socket: `*` and `?` are fnmatch (`-t 'cc-oth*'` and
    // `-t 'cc-oth?r-session'` both rc 0 against cc-other-session), `:` is
    // session:window (`-t cc-other-session:0` rc 0), `.` is window.pane, and
    // `=`/`%`/`$`/`@` are the exact-match and session/window/pane id sigils
    // (`-t '$0'` rc 0). They are refused positionally-free because the class is
    // an allow-list, not because each is dangerous in every position.
    for (const id of ['', '-leading', '1leading', 'Upper', 'has space', '../escape',
                      'semi;colon', 'dollar$sign', 'a'.repeat(33),
                      'a*', 'a?', 'a:b', 'a.b', 'a=b', 'a%b']) {
      const r = shFail(`${TMUX_OK} cmd_win_size --session '${id}' --mode smallest`);
      expect(r.code, `id: ${id}`).not.toBe(0);
      expect(r.stderr, `id: ${id}`).toContain('bad id:');
    }
    expect(calls(), 'a refused id must run no tmux at all').toEqual([]);
  });

  it('accepts the id class it is supposed to accept — the refusal above is not a blanket one', () => {
    // The control for the refusal case: fifteen ids in, fifteen refusals out
    // proves a gate fires, NOT that it fires on the right class — `[[ 1 == 2 ]]
    // || die` reds nothing above and refuses every id there is. These four are
    // ID_RE's own edges (bare letter, digits and hyphens, and exactly 32
    // characters, the longest the `{0,31}` tail admits) and must all reach tmux.
    for (const id of ['a', 'demo-quiet-basin', 'cc9-x-2', `a${'b'.repeat(31)}`]) {
      expect(h.sh(`${TMUX_OK} cmd_win_size --session '${id}' --mode smallest`)).toBe('smallest');
      expect(calls(), `id: ${id}`).toContain(`tmux set-option -t =cc-${id}: window-size smallest`);
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
