// D-3525 — EVERY TMUX TARGET IS EXACT: `=` + the tmux-sanitised name + `:`.
//
// A bare `-t cc-<id>` is not a name to tmux, it is a SEARCH: the exact name,
// then a unique PREFIX of a name, then an fnmatch pattern — and for a window-
// or pane-type command with no colon it first tries the string as a WINDOW
// NAME in the most recently used session. Measured on tmux 3.4 (private
// socket): with `cc-x` gone and `cc-x-2` live, `has-session -t cc-x` answers
// rc 0, `capture-pane`/`send-keys`/`set-option`/`resize-window` act on
// `cc-x-2`, and `kill-session -t cc-x` KILLS `cc-x-2`. `display-message`
// never fails at all. So a dead session probed `live`, its supervisor kept
// ticking against the sibling, and every kill path killed the sibling.
//
// `=cc-x` without the colon is exact only for SESSION-type commands:
// `list-panes`/`resize-window` still prefix-match and `capture-pane`,
// `send-keys`, `set-option` and `display-message` FAIL on a LIVE session
// (behind `2>/dev/null` in ccd — silently). `=cc-x:` is exact for every
// command ccd runs, and a missing session answers `can't find session: cc-x`
// for all of them — the one message `_session_probe` reads as death.
//
// tmux rewrites `.` and `:` in a session NAME to `_` (`-s cc-w-my.site`
// creates `cc-w-my_site`), so the target builder applies the same rewrite:
// an unsanitised `=cc-w-my.site:` answers `can't find session` for a LIVE
// session, which is `gone` — destroy-eligible.
//
// THIS SUITE RUNS REAL TMUX, ON A PRIVATE SOCKET, AND NOTHING ELSE. The
// harness's poisoned `tmux` (create-if-absent in `harnessBin`) is displaced by
// a shim that execs the real binary with `-L <private> -f /dev/null`, so
// `_session_probe`'s real `_plat_timeout` arm runs, not its function-stub arm.
// TMUX, TMUX_PANE and TMUX_TMPDIR are removed from every environment: an
// inherited TMUX points a client at the operator's server, and a deep
// TMUX_TMPDIR overflows `sun_path` (measured: `File name too long`). The
// socket name is short for macOS's shorter `sun_path`, and unique per run so
// concurrent suites never share a server. `afterAll` kills that server — by
// its own `-L`, never a bare `kill-server`.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, harnessBin, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';
import { tmuxTarget } from '../../shared/tmux-target.js';
import { Tmux, type Runner } from '../src/exec.js';

const ROOT = path.resolve(__dirname, '..', '..');
const KEEPALIVE = path.join(ROOT, 'ccd', 'ccd-telemetry-keepalive');

/** The real tmux, resolved on the ambient PATH BEFORE the harness prepends its
 *  own bin directory, and absolute so the shim can never find itself. */
const REAL_TMUX: string | null = (() => {
  const r = spawnSync('sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  const p = (r.stdout ?? '').trim();
  return r.status === 0 && p.startsWith('/') ? p : null;
})();
// NO tmux -> the behavioural half is a VISIBLE skip, never a silent pass, and
// the skip names its reason in the suite title, so a reporter that prints only
// titles still says why. Both CI legs install tmux
// (`.github/actions/server-deps`), so this only fires on a box that genuinely
// has none. The source census below runs regardless.
const NO_TMUX = REAL_TMUX === null;
const BEHAVIOURAL = 'D-3525 — ccd resolves every tmux target EXACTLY (real tmux, private socket)'
  + (NO_TMUX ? ' — SKIPPED: no tmux on PATH, so there is no real tmux to measure against' : '');

/** Short (macOS `sun_path`) and unique per run (concurrent suites). */
const SOCK = `ccanc${process.pid}${Math.random().toString(36).slice(2, 6)}`;

/** Every environment this file hands a process: TMUX, TMUX_PANE and
 *  TMUX_TMPDIR REMOVED (undefined keys are dropped by child_process). */
const NO_TMUX_ENV = { TMUX: undefined, TMUX_PANE: undefined, TMUX_TMPDIR: undefined };
const cleanEnv = (): NodeJS.ProcessEnv => ({ ...process.env, ...NO_TMUX_ENV });

/** The real tmux on the private socket — the fixture's own hand. */
const T = (...args: string[]): SpawnSyncReturns<string> =>
  spawnSync(REAL_TMUX!, ['-L', SOCK, '-f', '/dev/null', ...args], { encoding: 'utf8', env: cleanEnv() });

const sessions = (): string[] => {
  const r = T('list-sessions', '-F', '#{session_name}');
  return r.status === 0 ? r.stdout.split('\n').filter(Boolean).sort() : [];
};

/** A session whose pane prints `MARK-<name>` and then sits in `cat`, polled
 *  until the mark is on screen so a capture never races the shell. FIVE rows
 *  high, so the mark sits inside the bottom-eight window `_pane_for_keystroke`
 *  reads (a 50-row pane shows it only at the top, and that reader then sees a
 *  blank capture whatever the target); 200 wide, over READER_MIN_COLS. */
const mk = (name: string): void => {
  const r = T('new-session', '-d', '-s', name, '-x', '200', '-y', '5', `printf 'MARK-%s\\n' '${name}'; exec cat`);
  expect(r.status, `fixture new-session ${name}: ${r.stderr}`).toBe(0);
  const tgt = `=${name.replace(/[.:]/g, '_')}:`;
  for (let i = 0; i < 100; i++) {
    const c = T('capture-pane', '-p', '-t', tgt);
    if (c.status === 0 && c.stdout.includes('MARK-')) return;
    spawnSync('sleep', ['0.05']);
  }
  throw new Error(`fixture pane ${name} never printed its mark`);
};

/** No server on the private socket, MEASURED rather than assumed: `kill-server`
 *  returns before the server has gone, and a test that killed a server's last
 *  session leaves it exiting on its own — a `new-session` that lands in that
 *  window answers `server exited unexpectedly` (measured, this suite). So poll
 *  until tmux itself says there is nothing to connect to. */
const resetServer = (): void => {
  T('kill-server');
  for (let i = 0; i < 200; i++) {
    const r = T('list-sessions');
    if (r.status !== 0 && /no server running|error connecting/.test(r.stderr)) return;
    spawnSync('sleep', ['0.05']);
  }
  throw new Error(`the private tmux server on ${SOCK} would not go away`);
};

const created = (name: string): string =>
  T('display-message', '-p', '-t', `=${name}:`, '#{session_created}').stdout.trim();

let h: CcdHarness;

/** Runs a snippet against sourced ccd with the private-socket shim first on
 *  PATH; the snippet's own stdout, trimmed. */
const sh = (snippet: string): string => h.sh(snippet, NO_TMUX_ENV);

describe.skipIf(NO_TMUX)(BEHAVIOURAL, () => {
  beforeAll(() => {
    h = makeCcdHarness('ccrc-ccd-tmux-anchor-');
    // DISPLACES the harness's poisoned tmux (create-if-absent, so it is not
    // re-planted by the next `sh()`). `unset` again inside the shim: belt and
    // braces against a caller that forgets the env.
    fs.writeFileSync(path.join(harnessBin(h.home), 'tmux'),
      `#!/bin/sh\nunset TMUX TMUX_PANE TMUX_TMPDIR\nexec '${REAL_TMUX}' -L '${SOCK}' -f /dev/null "$@"\n`,
      { mode: 0o755 });
  });
  afterAll(() => {
    if (REAL_TMUX !== null) T('kill-server');
    // tmux leaves the socket FILE behind after `kill-server` (measured, 3.4).
    // Its path is tmux's own default — `/tmp/tmux-<uid>/<name>`, since
    // TMUX_TMPDIR is unset — and the name is this run's alone.
    if (typeof process.getuid === 'function') {
      fs.rmSync(path.join('/tmp', `tmux-${process.getuid()}`, SOCK), { force: true });
    }
    h?.cleanup();
  });
  beforeEach(() => { resetServer(); });

  describe('MISS — `cc-demo` is gone and `cc-demo-2` is live', () => {
    beforeEach(() => { mk('cc-demo-2'); });

    it('_session_probe answers gone, not the sibling\'s live', () => {
      expect(sh('_session_probe demo; echo "$PROBE_VERDICT/$PROBE_SUBSTRATE"')).toBe('gone/present');
    });

    it('_pane_born answers nothing, not the sibling\'s session_created', () => {
      expect(sh('_pane_born demo; true')).toBe('');
    });

    it('_pane_measurable refuses — it does not measure the sibling', () => {
      expect(sh('_pane_measurable demo; echo "rc=$?"')).toBe('rc=1');
    });

    it('_pane_for_keystroke cannot read the sibling\'s pane', () => {
      const out = sh('_pane_for_keystroke demo; echo "rc=$?|$KS_WHY|$KS_PANE"');
      expect(out).not.toContain('MARK-cc-demo-2');
      expect(out.startsWith('rc=1|')).toBe(true);
    });

    it('cmd_stop demo leaves cc-demo-2 alive', () => {
      sh('_ws_unsupervise() { :; }; cmd_stop demo >/dev/null 2>&1; true');
      expect(sessions()).toEqual(['cc-demo-2']);
    });

    it('the keepalive\'s pane probe answers gone, not the sibling\'s live', () => {
      expect(kaProbe('demo')).toBe('gone');
    });
  });

  describe('CONTROLS — the same calls against a live `cc-demo`, so nothing passes by failing everything', () => {
    beforeEach(() => { mk('cc-demo'); });

    it('_session_probe answers live', () => {
      expect(sh('_session_probe demo; echo "$PROBE_VERDICT/$PROBE_SUBSTRATE"')).toBe('live/present');
    });

    it('_pane_born answers the session\'s own session_created', () => {
      const born = sh('_pane_born demo; true');
      expect(born).toMatch(/^\d+$/);
      expect(born).toBe(created('cc-demo'));
    });

    it('_pane_measurable measures it', () => {
      expect(sh('_pane_measurable demo; echo "rc=$?"')).toBe('rc=0');
    });

    it('_pane_for_keystroke reads its own pane', () => {
      expect(sh('_pane_for_keystroke demo; echo "rc=$?|$KS_PANE"')).toMatch(/^rc=0\|[\s\S]*MARK-cc-demo\b/);
    });

    it('cmd_stop demo kills it', () => {
      sh('_ws_unsupervise() { :; }; cmd_stop demo >/dev/null 2>&1; true');
      expect(sessions()).toEqual([]);
    });

    it('the keepalive\'s pane probe answers live', () => {
      expect(kaProbe('demo')).toBe('live');
    });
  });

  it('WIN — a later session\'s window NAMED cc-demo is not what ccd reads', () => {
    // A window- or pane-type target with no colon is tried first as a window
    // name in the most recently used session. The 1.1s gap makes the two
    // `session_created` epochs differ, so the comparison below can tell them
    // apart at all.
    mk('cc-demo');
    spawnSync('sleep', ['1.1']);
    mk('other');
    expect(T('rename-window', '-t', '=other:', 'cc-demo').status).toBe(0);
    expect(created('other')).not.toBe(created('cc-demo'));
    expect(sh('_pane_born demo; true')).toBe(created('cc-demo'));
    expect(sh('_pane_for_keystroke demo; echo "$KS_PANE"')).toContain('MARK-cc-demo');
    expect(sh('_pane_for_keystroke demo; echo "$KS_PANE"')).not.toContain('MARK-other');
  });

  it('a DOTTED id, created through _tmux_new_session, probes live — tmux renamed it and the target follows', () => {
    // `_ws_project_valid` admits a dot; tmux names `cc-w-my.site` as
    // `cc-w-my_site`. Bare, the probe answers `can't find pane: site`
    // (unknown); anchored WITHOUT the rewrite it answers `can't find session`
    // (gone — destroy-eligible for a live session).
    sh(`_tmux_new_session -d -s "$(_tmux w-my.site)" -x 200 -y 50 'exec cat' >/dev/null 2>&1; true`);
    expect(sessions()).toEqual(['cc-w-my_site']);
    expect(sh('_session_probe w-my.site; echo "$PROBE_VERDICT"')).toBe('live');
    expect(sh('_pane_measurable w-my.site; echo "rc=$?"')).toBe('rc=0');
    // The keepalive spells the same rewrite on its own: unrewritten, it would
    // read this live pane as gone and spend a turn beside it.
    expect(kaProbe('w-my.site')).toBe('live');
  });

  it('no server at all: unknown with substrate absent — the polarity is untouched', () => {
    expect(sessions()).toEqual([]);
    expect(sh('_session_probe demo; echo "$PROBE_VERDICT/$PROBE_SUBSTRATE"')).toBe('unknown/absent');
  });

  describe('the SERVER adapter against the same real tmux — every read, and its classifier', () => {
    // The only place the classifiers' new death message is measured against
    // real tmux rather than a transcribed literal (on the macOS leg, tmux
    // 3.7c, the first measurement there at all). The runner is `realRunner`'s
    // shape with the private socket prepended and TMUX* removed.
    const run: Runner = (cmd, args) => new Promise((resolve) => {
      expect(cmd).toBe('tmux');
      const r = spawnSync(REAL_TMUX!, ['-L', SOCK, '-f', '/dev/null', ...args], { encoding: 'utf8', env: cleanEnv() });
      resolve({ code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' });
    });
    const tx = new Tmux(run);

    it('MISS: gone, no pid, gone, gone, nothing — never the sibling', async () => {
      mk('cc-demo-2');
      expect(await tx.sessionVerdict('demo')).toEqual({ verdict: 'gone' });
      expect(await tx.panePid('demo')).toBeNull();
      expect(await tx.paneProbe('demo')).toEqual({ ok: false, reason: 'gone' });
      expect(await tx.captureHistory('demo', 50)).toEqual({ ok: false, reason: 'gone' });
      expect(await tx.capture('demo')).toBeNull();
      expect(await tx.sendLiteral('demo', 'TYPED')).toBe(false);
      expect(await tx.resizeWindow('demo', 60, 20)).toBe(false);
      expect(T('capture-pane', '-p', '-t', '=cc-demo-2:').stdout).not.toContain('TYPED');
      expect(T('display-message', '-p', '-t', '=cc-demo-2:', '#{window_width}').stdout.trim()).toBe('200');
    });

    it('control: a live cc-demo reads as itself', async () => {
      mk('cc-demo');
      expect(await tx.sessionVerdict('demo')).toEqual({ verdict: 'live' });
      expect(await tx.panePid('demo')).toEqual(expect.any(Number));
      expect(await tx.paneProbe('demo')).toMatchObject({ ok: true, width: 200 });
      const h2 = await tx.captureHistory('demo', 50);
      expect(h2.ok && h2.text.includes('MARK-cc-demo')).toBe(true);
      expect(await tx.capture('demo')).toContain('MARK-cc-demo');
    });

    it('no server: unknown / unreadable / unmeasured — never gone', async () => {
      expect(await tx.sessionVerdict('demo')).toMatchObject({ verdict: 'unknown' });
      expect(await tx.paneProbe('demo')).toMatchObject({ ok: false, reason: 'unreadable' });
      expect(await tx.captureHistory('demo', 50)).toMatchObject({ ok: false, reason: 'unmeasured' });
    });
  });

  describe('the sign-in pane — `claude` is a prefix of `claude-a` in the test roster', () => {
    const cancel = (id: string): string =>
      sh(`cmd_account_pane --id ${id} --cancel 2>/dev/null; true`);

    it('--cancel for `claude` leaves `cc-auth-claude-a` alive and cancels nothing', () => {
      mk('cc-auth-claude-a');
      expect(JSON.parse(cancel('claude'))).toEqual({ cancelled: null });
      expect(sessions()).toEqual(['cc-auth-claude-a']);
    });

    it('control: --cancel for `claude-a` kills its own pane', () => {
      mk('cc-auth-claude-a');
      expect(JSON.parse(cancel('claude-a'))).toEqual({ cancelled: 'cc-auth-claude-a' });
      expect(sessions()).toEqual([]);
    });
  });
});

/** The keepalive's `_ka_pane_probe`, lifted out of the script (which runs its
 *  pass at top level and cannot be sourced) and run against the private
 *  socket through the same shim. A `timeout` stand-in only where the box has
 *  none (the keepalive is Linux-only on the record; macOS has `gtimeout`). */
function kaProbe(id: string): string {
  const src = fs.readFileSync(KEEPALIVE, 'utf8');
  const fn = /\n(_ka_pane_probe\(\) \{[\s\S]*?\n\})\n/.exec(src);
  if (fn === null) throw new Error('ccd-telemetry-keepalive has no _ka_pane_probe');
  const prefix = /^KA_TMUX_PREFIX='([^']*)'/m.exec(src)?.[1];
  // The harness's own containment, like every ccd spawn in this suite: its
  // `tmux` is the private-socket shim planted above (create-if-absent keeps it).
  const env = ghContainedEnv(h.home, { ...cleanEnv(), HOME: h.home }, { systemd: true, tmux: true });
  const r = spawnSync('bash', ['-c',
    `command -v timeout >/dev/null 2>&1 || timeout() { shift; "$@"; }
     KA_TMUX_PREFIX='${prefix}'; KA_PANE_DEADLINE=5
     ${fn[1]}
     _ka_pane_probe "$1"; printf '%s' "$KA_PANE_VERDICT"`, 'ka', id],
  { encoding: 'utf8', cwd: h.home, env });
  return r.stdout;
}

// ── THE CENSUS: every target in the tree is built by the one builder ────────
//
// The behavioural half above proves the builder; this half proves every call
// site USES it. Per D-2781 it scans the CALL: a literal `-t cc-` appears only
// in comments, so a scan for that string proves nothing.

const CCD_SRC = fs.readFileSync(CCD, 'utf8');
const KA_SRC = fs.readFileSync(KEEPALIVE, 'utf8');

/** Whole-line comments dropped (the cut `ccd-account-pane.test.ts` makes). */
const executable = (src: string): string[] =>
  src.split('\n').map((l) => (/^\s*#/.test(l) ? '' : l));

/** A tmux COMMAND on the line — `tmux <verb>`, never `type -t tmux`. */
const TMUX_CALL = /(?:^|[\s;|&(!{`])tmux\s+[a-z][a-z-]*/;
/** The `-t` argument, as bash would group it: `"$( … )"` with its inner
 *  quotes, any other double- or single-quoted word, or a bare word. */
const T_ARG = /\s-t\s+("\$\([^()]*\)"|"[^"]*"|'[^']*'|[^\s;|&)]+)/g;

interface TSite { line: number; arg: string }
const targetSites = (src: string): TSite[] => {
  const out: TSite[] = [];
  executable(src).forEach((l, i) => {
    if (!TMUX_CALL.test(l)) return;
    for (const m of l.matchAll(T_ARG)) out.push({ line: i + 1, arg: m[1]! });
  });
  return out;
};

/** The three spellings a ccd `-t` may take. `_tmux_t` builds a target from a
 *  registry id; `_tmux_at` anchors a tmux NAME a function already holds; `$t`
 *  is a variable the per-function check below proves was bound from one of
 *  them. Anything else — a bare `$(_tmux …)`, a hand-anchored `=…` (the
 *  colon-less form fails silently on pane commands), a literal — is refused. */
const ALLOWED_CCD_ARG = /^(?:"\$\(_tmux_t "[^"]*"\)"|"\$\(_tmux_at "[^"]*"\)"|"\$t")$/;

/** Every function in ccd/ccd, by its `^name() {` … `^}` text. */
const functions = (src: string): Map<string, string> => {
  const fns = new Map<string, string>();
  // `{` ENDS the header line (a trailing comment allowed): a one-liner such as
  // `_tmux() { echo …; }` would otherwise swallow the next function's body.
  for (const m of src.matchAll(/\n([A-Za-z_][A-Za-z0-9_]*)\(\) *\{(?:[ \t]*#[^\n]*)?\n([\s\S]*?)\n\}\n/g)) {
    fns.set(m[1]!, executable(m[2]!).join('\n'));
  }
  return fns;
};

/** Every binding of the variable `t` in a body — `local t="…"`, `t=$(…)`,
 *  `local id="$1" t="$2" …` — as the right-hand side's text. */
const tBindings = (body: string): string[] =>
  [...body.matchAll(/(?:^|[\s;])t=("\$\([^()]*\)"|\$\([^()]*\)|"[^"]*"|[^\s;]*)/gm)].map((m) => m[1]!);

/** Splits a call's argument text into bash words, quote-aware enough for the
 *  shapes ccd uses (`"$pane" "$t" "allow external imports"`). */
const words = (s: string): string[] => [...s.matchAll(/"[^"]*"|'[^']*'|[^\s;|&]+/g)].map((m) => m[0]);

describe('D-3525 — the census: every ccd target is spelled by the exact builder', () => {
  const sites = targetSites(CCD_SRC);

  it('the scan reads the tree — a floor on the target sites it found', () => {
    // MEASURED on this tree (D-3525's commit): 80 target sites — `_tmux_t
    // "$1"` 5, `_tmux_t "$id"` 16, `_tmux_at` 11 (`$t` 3, `$pane` 3, `$tname`
    // 5), `$t` 48 — the same 80 the bare spellings occupied before it, and a
    // walk of every executable line carrying both `tmux` and `-t` found none
    // this scan misses. A floor, not an equality (the file grows); an empty
    // scan would pass every assertion below.
    expect(sites.length).toBeGreaterThanOrEqual(80);
  });

  it('every `-t` in ccd/ccd is `$(_tmux_t …)`, `$(_tmux_at …)` or `$t`', () => {
    const bad = sites.filter((s) => !ALLOWED_CCD_ARG.test(s.arg)).map((s) => `ccd/ccd:${s.line} -t ${s.arg}`);
    expect(bad).toEqual([]);
  });

  it('no `-t` is the bare NAME builder, and no `-t` is hand-anchored', () => {
    // Over EVERY executable line, not only the ones `TMUX_CALL` recognises, so
    // a tmux call spelled in a shape that scan misses is still caught here.
    const hits = executable(CCD_SRC).flatMap((l, i) =>
      (/-t "\$\(_tmux "/.test(l) || /-t "=/.test(l) ? [`ccd/ccd:${i + 1}: ${l.trim()}`] : []));
    expect(hits).toEqual([]);
  });

  it('the builders are defined once, and `_tmux` stays the NAME builder', () => {
    expect((CCD_SRC.match(/^_tmux_at\(\) /gm) ?? []).length).toBe(1);
    expect((CCD_SRC.match(/^_tmux_t\(\) /gm) ?? []).length).toBe(1);
    expect(CCD_SRC).toMatch(/^_tmux\(\)\s+\{ echo "cc-\$1"; \}/m);
  });

  it('a `$t` used as a target is only ever BOUND from the exact builder — or passed through from a caller that did', () => {
    const fns = functions(CCD_SRC);
    const passThrough = new Map<string, number>();   // fn -> which positional carries t
    const checked: string[] = [];
    for (const [name, body] of fns) {
      if (!body.includes('-t "$t"')) continue;
      checked.push(name);
      const binds = tBindings(body);
      expect(binds.length, `${name} uses -t "$t" but never binds t`).toBeGreaterThan(0);
      for (const b of binds) {
        const pos = /^"\$(\d)"$/.exec(b);
        if (pos) { passThrough.set(name, Number(pos[1])); continue; }
        expect(b, `${name} binds t from something other than the exact builder`)
          .toMatch(/^\$\(_tmux_(?:t|at) "[^"]*"\)$/);
      }
    }
    // Non-vacuity: the typers, the readers and the three pass-through helpers.
    expect(checked.length).toBeGreaterThanOrEqual(12);
    expect([...passThrough.keys()].sort())
      .toEqual(['_answer_two_option_dialog', '_route_ack_wait', '_route_effort_ack_wait']);
    // A pass-through helper's every caller hands it `"$t"` in that position —
    // and that caller is itself one of the functions checked above.
    for (const [fn, pos] of passThrough) {
      let calls = 0;
      for (const [caller, body] of fns) {
        for (const m of body.matchAll(new RegExp(`(?:^|[\\s;|&(!])${fn} ([^\\n]*)`, 'gm'))) {
          calls++;
          expect(words(m[1]!)[pos - 1], `${caller} calls ${fn} with a target that is not "$t"`).toBe('"$t"');
          expect(checked, `${caller} passes "$t" to ${fn} but its own t is unchecked`).toContain(caller);
        }
      }
      expect(calls, `${fn} has no callers — the pass-through check is vacuous`).toBeGreaterThan(0);
    }
  });

  it('the keepalive\'s one probe is the exact form, sanitised the way `_tmux_at` sanitises', () => {
    const ka = targetSites(KA_SRC);
    expect(ka.map((s) => s.arg)).toEqual(['"=${KA_TMUX_PREFIX}${1//[.:]/_}:"']);
    // The SAME rewrite on both sides: a keepalive that anchored without it
    // would read a live dotted session as gone and spend a turn on it.
    expect(CCD_SRC).toMatch(/^_tmux_at\(\) \{ local n="\$\{1\/\/\[\.:\]\/_\}"; echo "=\$n:"; \}/m);
  });
});

describe('D-3525 — the census: every TypeScript tmux target is `tmuxTarget`', () => {
  const tsFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts'))
      .map((f) => path.join(dir, f));
  const code = (f: string): string =>
    fs.readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  it('every `\'-t\'` argv element in server/src and agent/src is followed by tmuxTarget(…)', () => {
    const found: string[] = [];
    const bad: string[] = [];
    for (const f of [...tsFiles(path.join(ROOT, 'server', 'src')), ...tsFiles(path.join(ROOT, 'agent', 'src'))]) {
      for (const m of code(f).matchAll(/'-t',\s*([^,\]\n]+)/g)) {
        found.push(`${path.relative(ROOT, f)}: ${m[1]!.trim()}`);
        if (!/^tmuxTarget\(/.test(m[1]!.trim())) bad.push(`${path.relative(ROOT, f)}: -t ${m[1]!.trim()}`);
      }
    }
    // exec.ts's nine methods and the two attach argvs.
    expect(found.length).toBeGreaterThanOrEqual(11);
    expect(bad).toEqual([]);
  });

  it('tmuxTarget is the anchored, sanitised form', () => {
    expect(tmuxTarget('myid')).toBe('=cc-myid:');
    expect(tmuxTarget('w-my.site')).toBe('=cc-w-my_site:');
    expect(tmuxTarget('a:b.c')).toBe('=cc-a_b_c:');
  });
});
