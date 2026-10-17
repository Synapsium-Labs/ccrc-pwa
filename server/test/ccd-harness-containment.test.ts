// server/test/ccd-harness-containment.test.ts
//
// THE SYSTEMD BOUNDARY, made a property of the harness rather than a rule each
// ccd test file remembers. `makeCcdHarness` spreads `...process.env`, so the
// real user manager is reachable; `claude-session@.service` IS installed on
// this box; `[Install] WantedBy=default.target` writes a PERSISTENT symlink
// into the live `~/.config/systemd/user/default.target.wants/`; `ExecStart` +
// `Restart=always` would then run a supervise loop against a vitest tmpdir —
// and `_ws_supervise` SWALLOWS the error, so the test would pass green.
//
// Same shape and the same argument as the poisoned `gh` beside it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  makeCcdHarness, harnessBin, ghContainedEnv, stubContainedTool, WS_ADD, SCAN_LOOKBACK_LINES, type ContainOpts,
  type CcdHarness,
} from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';
import { CONTAINED_TOOLS, assertNoRealTool } from './containedTools.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-contain-'); });
afterEach(() => { h.cleanup(); });

describe('the harness contains systemctl structurally', () => {
  it('answers `command -v systemctl` — the box HAS one, it just refuses to act', () => {
    // _have_systemctl must stay TRUE, or every test silently takes
    // _supervised_start's no-systemctl fallback instead of the real path.
    expect(h.sh('_have_systemctl && echo yes || echo no')).toBe('yes');
  });

  it('records every argv and refuses, so no real unit can be enabled', () => {
    // THE POISON ITSELF is the subject here, not a ccd path through it — the
    // manager is invoked directly and its own log read back RAW, so this says
    // nothing about vocabularies and everything about containment. Each
    // platform's poison is checked on its own terms; `h.systemctlCalls()` is
    // deliberately not used, because it translates.
    const mgr = process.platform === 'darwin' ? 'launchctl' : 'systemctl';
    const argv = process.platform === 'darwin'
      ? 'enable gui/501/app.ccrc.session.demo-quiet-basin'
      : '--user enable --now claude-session@demo-quiet-basin';
    h.sh(`${mgr} ${argv} 2>/dev/null; :`);
    expect(fs.readFileSync(path.join(h.home, `${mgr}-calls`), 'utf8')
      .split('\n').filter((l) => l !== '')).toEqual([argv]);
  });

  it('exits non-zero, so a caller that checks cannot mistake it for a real enable', () => {
    expect(h.sh('systemctl --user enable --now x >/dev/null 2>&1; echo rc=$?')).toBe('rc=97');
  });

  it('is reachable from a ccd path that does NOT stub systemctl (the whole point)', () => {
    h.sh('_ws_supervise demo-quiet-basin 2>/dev/null; :');
    expect(h.systemctlCalls()).toEqual(['--user enable --now claude-session@demo-quiet-basin']);
  });

  it('lets a test that needs a FUNCTIONAL systemctl win, and KEEPS letting it', () => {
    // The rule the two `runCcd` idioms now follow: a PATH stub goes in
    // harnessBin(), where it replaces the poison. Ordering cannot decide it —
    // ghContainedEnv PREPENDS its own dir, deliberately, so that the gh poison
    // cannot be displaced, and a second stub dir would always lose.
    //
    // THE SECOND `h.sh` IS THE ASSERTION. ghContainedEnv runs on EVERY sh(),
    // so an unconditionally-written poison would re-plant itself between these
    // two lines and silently break ccd-supervised-start.test.ts, whose whole
    // UNIT fixture is a functional `systemctl --user enable --now` touching
    // $HOME/pane-up.
    fs.writeFileSync(path.join(harnessBin(h.home), 'systemctl'),
      '#!/bin/sh\necho "systemctl $*" >> "$HOME/ccd-calls"\nexit 0\n', { mode: 0o755 });
    expect(h.sh('systemctl --user is-active x >/dev/null 2>&1; echo rc=$?')).toBe('rc=0');
    expect(h.sh('systemctl --user is-active x >/dev/null 2>&1; echo rc=$?')).toBe('rc=0');
  });

  it('but the gh poison is NOT displaceable — the asymmetry is deliberate', () => {
    // The host gh carries a gho_ token with repo WRITE scope. That containment
    // is absolute and re-plants on every sh(); the systemd one is
    // create-if-absent so a test can model a unit.
    fs.writeFileSync(path.join(harnessBin(h.home), 'gh'),
      '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    expect(h.sh('gh pr list >/dev/null 2>&1; echo rc=$?')).toBe('rc=97');
  });

  it('WS_ADD shadows all three: _spawn, _ws_supervise and _supervised_start', () => {
    // The stub set is the three TOGETHER. Reporting "no systemd" is not enough:
    // it sends _supervised_start down its FALLBACK into a real _spawn.
    expect(WS_ADD).toContain('_spawn()');
    expect(WS_ADD).toContain('_ws_supervise()');
    expect(WS_ADD).toContain('_supervised_start()');
  });
});

// ── THE CROSS-FILE CONTRACT, and the regression that named it ─────────────
// The systemd poison above arrived planted from inside `ghContainedEnv`,
// UNCONDITIONALLY and in `harnessBin()` — the directory that function PREPENDS
// so nothing can displace the `gh` poison. `ghContainedEnv` is imported by
// files that run no ccd at all, and one of them, `ccrc-doctor.test.ts`, builds
// its PATH from it and then plants its own FUNCTIONAL `systemctl` in a
// directory of its OWN (`<home>/stub-bin`, second on that PATH). The two stubs
// were never in the same directory, so the create-if-absent guard could not
// see the collision: the poison simply won on ordering, ccrc's `_box_units`
// read a refusal instead of the fixture's answer, and five `ccrc status` tests
// reported `role: unknown`. Measured: 170/170 on main, 165/170 merged.
//
// So the remit of each poison is now stated rather than assumed. `gh` is
// unconditional — the host token has repo WRITE scope and no caller may opt
// out. systemd is ASKED FOR, by the callers that run ccd; a consumer that did
// not ask keeps the PATH it built, stubs and all.
//
// This is the guard that would have caught the widening. Without it the next
// helper that grows a second job re-runs the same failure, and the symptom
// again surfaces three files away from the edit.
describe('ghContainedEnv contains gh always, systemd only when asked', () => {
  /** The two spawn lines below are one mechanism, and they sit together because
   *  the source scan in `ccd-workspaces.test.ts` reads the lines AROUND a bash
   *  spawn: an env assembled inside each `it` would be invisible to it — which
   *  is also why the marker below sits at the END of this comment rather than
   *  the top: the scan's window looks back only `SCAN_LOOKBACK_LINES`
   *  (`ccdWsHelpers.ts`) lines from the spawn it reads — see the self-check
   *  `it` below the tmux tests, which pins that distance directly.
   *
   *  `BASH` is bash resolved under the REAL PATH, once — every spawn here hands
   *  the child a fixture-only PATH, and libuv resolves the executable against
   *  the CHILD's env, so bare `bash` would be ENOENT. Same trick
   *  `ccrc-doctor.test.ts` uses, for the same reason.
   *
   *  This call site runs NO ccd at all — the only one in the suite that
   *  doesn't — and that ONE condition logically ENTAILS both of the scan's
   *  exemptions below, systemd's and tmux's, rather than being two conditions
   *  collapsing into one token: a site that runs no ccd can need neither
   *  poison. That is also the boundary: a future call site needing exactly
   *  ONE exemption (a test parameterizing `tmux` while holding `systemd`
   *  fixed at `true`, so it DOES run ccd) has not earned "runs no ccd" and
   *  must mint its own marker, not reuse this one.
   *
   *  SYSTEMD-OPT-OUT IS THE ASSERTION is that marker, read by both scan
   *  clauses. It measures the OPTION, and half of what follows asserts
   *  nothing unless it runs with the option OFF. `gh` is exempt from nothing,
   *  here or anywhere, and is asserted below like every other call site. */
  const BASH = execFileSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
  const run = (home: string, bin: string, snippet: string,
    opts: ContainOpts = {}, extra: NodeJS.ProcessEnv = {}): string => {
    const env = ghContainedEnv(home, { PATH: bin }, opts);
    return execFileSync(BASH, ['-c', `${snippet} 2>/dev/null; echo "rc=$?"`],
      { encoding: 'utf8', env: { ...env, HOME: home, ...extra } }).trim();
  };

  /** A consumer in `ccrc-doctor.test.ts`'s shape: its own stub directory, its
   *  own FUNCTIONAL `systemctl` in it, and a PATH with no system directory on
   *  it at all. */
  function consumer(prefix: string): { home: string; bin: string } {
    const home = mkTmp(prefix);
    const bin = path.join(home, 'stub-bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'systemctl'), '#!/bin/sh\necho "mine: $*"\nexit 0\n', { mode: 0o755 });
    return { home, bin };
  }

  it('leaves a non-asking consumer\'s OWN systemctl answering, on its own PATH', () => {
    const { home, bin } = consumer('ccrc-contain-optout-');
    expect(run(home, bin, 'command -v systemctl')).toBe(`${path.join(bin, 'systemctl')}\nrc=0`);
    expect(run(home, bin, 'systemctl --user is-active ccrc.service'))
      .toBe('mine: --user is-active ccrc.service\nrc=0');
    // Not merely "the poison lost the race": it was never written. The
    // create-if-absent guard cannot answer a collision across two directories,
    // so absence here is the only thing that makes the consumer's stub reachable.
    expect(fs.existsSync(path.join(harnessBin(home), 'systemctl'))).toBe(false);
    expect(fs.existsSync(path.join(harnessBin(home), 'systemd-run'))).toBe(false);
  });

  it('still poisons gh for that same consumer — THAT one is never optional', () => {
    // The asymmetry, asserted on the caller that opted out of the other half:
    // opting out of systemd must not be a way to opt out of gh, and a consumer
    // that plants its own `gh` must still lose to the poison.
    const { home, bin } = consumer('ccrc-contain-optout-gh-');
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    expect(run(home, bin, 'gh pr list')).toBe('rc=97');
    expect(fs.readFileSync(path.join(home, 'gh-poison'), 'utf8').trim()).toBe('pr list');
  });

  it('plants the systemd poison when a caller DOES ask, over that same PATH', () => {
    // The positive control on the OPTION itself (the harness's own use of it is
    // what the describe above measures): asking must beat the consumer's stub,
    // because for a ccd runner the stub is the thing that must not win.
    const { home, bin } = consumer('ccrc-contain-optin-');
    expect(run(home, bin, 'command -v systemctl', { systemd: true }))
      .toBe(`${path.join(harnessBin(home), 'systemctl')}\nrc=0`);
    expect(run(home, bin, 'systemctl --user enable --now claude-session@x', { systemd: true })).toBe('rc=97');
    expect(fs.readFileSync(path.join(home, 'systemctl-calls'), 'utf8').trim())
      .toBe('--user enable --now claude-session@x');
    // SYSTEMD_RUN_RC steering survives the move behind the option: it is what
    // makes `_tmux_server_ensure`'s `||` fallback reachable as a negative
    // control rather than dead code behind a refusal-only stub.
    expect(run(home, bin, 'systemd-run --user true', { systemd: true }, { SYSTEMD_RUN_RC: '0' })).toBe('rc=0');
    expect(run(home, bin, 'systemd-run --user true', { systemd: true })).toBe('rc=97');
  });

  // ── THE TMUX HALF (Task 11b), symmetric to the three systemd tests above ──
  // and covering exactly the mechanics Task 11's reviewer proved by hand in
  // scratch tests that were then deleted: create-if-absent, the opt-in itself
  // in both directions, and TMUX_STUB_RC steering the poison to succeed. "A
  // comment is a request; a red suite is a mechanism" — this is the mechanism.
  it('leaves a non-asking consumer\'s OWN tmux answering, on its own PATH', () => {
    // Mirrors the systemd opt-out test above, one poison over: a consumer
    // that never asks for `{ tmux: true }` keeps whatever it planted on its
    // own PATH, because the harness never wrote a tmux poison for it to lose
    // to.
    const { home, bin } = consumer('ccrc-contain-tmux-optout-');
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "mine: $*"\nexit 0\n', { mode: 0o755 });
    expect(run(home, bin, 'command -v tmux')).toBe(`${path.join(bin, 'tmux')}\nrc=0`);
    expect(run(home, bin, 'tmux list-panes -a')).toBe('mine: list-panes -a\nrc=0');
    // Not merely "the poison lost the race": it was never written, same as
    // the systemd case above.
    expect(fs.existsSync(path.join(harnessBin(home), 'tmux'))).toBe(false);
  });

  it('plants the tmux poison when a caller DOES ask, over that same PATH', () => {
    // The positive control on the tmux OPTION itself, and the steering test
    // the coordinator asked for by name: TMUX_STUB_RC is to `_lc_obs`'s
    // `tmux list-panes -a` what SYSTEMD_RUN_RC is to `_tmux_server_ensure`'s
    // `systemd-run` — the one way a test may make the stub SUCCEED, so the
    // "tmux present and answering" branch is reachable as a positive control
    // rather than dead code behind a refusal-only stub.
    const { home, bin } = consumer('ccrc-contain-tmux-optin-');
    fs.writeFileSync(path.join(bin, 'tmux'), '#!/bin/sh\necho "mine: $*"\nexit 0\n', { mode: 0o755 });
    expect(run(home, bin, 'command -v tmux', { tmux: true }))
      .toBe(`${path.join(harnessBin(home), 'tmux')}\nrc=0`);
    expect(run(home, bin, 'tmux list-panes -a', { tmux: true })).toBe('rc=97');
    expect(fs.readFileSync(path.join(home, 'tmux-calls'), 'utf8').trim()).toBe('list-panes -a');
    expect(run(home, bin, 'tmux list-panes -a', { tmux: true }, { TMUX_STUB_RC: '0' })).toBe('rc=0');
    expect(run(home, bin, 'tmux list-panes -a', { tmux: true })).toBe('rc=97');
  });

  it('create-if-absent for tmux too: a caller-owned stub planted in harnessBin() KEEPS winning', () => {
    // Symmetric to `describe('the harness contains systemctl structurally')`'s
    // "lets a test that needs a FUNCTIONAL systemctl win, and KEEPS letting
    // it" above, but through THIS describe's own `run()`/`BASH` idiom instead
    // of `h.sh()`, and in the SAME directory `{ tmux: true }` would write its
    // poison into (`harnessBin()`), not `consumer()`'s separate stub-bin —
    // the create-if-absent guard only answers WITHIN harnessBin, so a stub
    // outside it would not be testing this at all. `run()` calls
    // `ghContainedEnv` fresh on every invocation, same as `h.sh()` does, so
    // the SECOND call is the assertion: a re-plant would silently replace
    // what the first call built.
    const home = mkTmp('ccrc-contain-tmux-createabsent-');
    const bin = harnessBin(home);
    fs.writeFileSync(path.join(bin, 'tmux'),
      '#!/bin/sh\necho "mine: $*" >> "$HOME/ccd-calls"\nexit 0\n', { mode: 0o755 });
    expect(run(home, bin, 'tmux list-panes -a', { tmux: true })).toBe('rc=0');
    expect(run(home, bin, 'tmux list-panes -a', { tmux: true })).toBe('rc=0');
    // The poison's own log file must not exist: if the poison had ever run,
    // even once, it would have created it.
    expect(fs.existsSync(path.join(home, 'tmux-calls'))).toBe(false);
  });

  it('keeps the SYSTEMD-OPT-OUT marker within the scan\'s lookback window of every spawn it exempts', () => {
    // Fix Round 2's self-check. Fix Round 1 pushed the marker out of the
    // scan's window with a comment-only edit, and the failure that produced
    // was a LIE about the cause: "runs ccd without asking for tmux
    // containment", when the real defect was "the marker fell out of
    // range" — two conditions a reader must handle differently,
    // collapsed to one message. This asserts the real invariant, at the
    // site a future comment edit would break it, with a message that names
    // the actual problem instead.
    const src = fs.readFileSync(path.join(__dirname, 'ccd-harness-containment.test.ts'), 'utf8').split('\n');
    const markerLine = src.findIndex((ln) => ln.includes('SYSTEMD-OPT-OUT IS THE ASSERTION'));
    expect(markerLine, 'the marker text itself is missing from this file').toBeGreaterThanOrEqual(0);
    // The SAME match `ccd-workspaces.test.ts`'s scan uses to find a bash-spawn
    // call site — duplicated here rather than exported, per the "no new
    // abstractions" bound on this fix: this exists to find the ACTUAL spawn
    // lines in THIS file, not to become a second scan.
    const spawnLines = src
      .map((ln, i) => (/(?:execFileSync|spawnSync)\((?:'bash'|BASH)[,)]/.test(ln) ? i : -1))
      .filter((i) => i >= 0);
    expect(spawnLines.length, 'no bash-spawn call site found in this file to check the marker against')
      .toBeGreaterThanOrEqual(2);
    for (const spawnLine of spawnLines) {
      const distance = spawnLine - markerLine;
      expect.soft(distance,
        `the marker sits ${distance} lines before the spawn at ` +
        `ccd-harness-containment.test.ts:${spawnLine + 1} — that is outside ` +
        `SCAN_LOOKBACK_LINES (${SCAN_LOOKBACK_LINES}), so the scan would misreport this call site as ` +
        `LACKING CONTAINMENT rather than as "the marker fell out of the window"`)
        .toBeLessThanOrEqual(SCAN_LOOKBACK_LINES);
    }
  });
});

// ── WAVE 18 (centralised update management; D-5247, D-5248, D-5249): ssh, scp, curl and the user bus ──────────────
// Wave 9 (R10d) made the ccrc builders' containment structural and left this harness's half as residue: every
// `sh()` still inherited the operator's real `XDG_RUNTIME_DIR` and `DBUS_SESSION_BUS_ADDRESS`, and found the host's
// own `ssh`, `scp` and `curl` on the PATH tail (measured at the wave's base: `/usr/bin/…` for all three, and the
// real `/run/user/<uid>` pair). `ccd/ccd` calls none of the three tools and reads the bus only through the
// poisoned managers, so it was a structural gap, not a live leak: the edit that adds a curl to ccd, or drops a
// manager poison, would have reached the live machine with nothing red. These rows are what is red now.
//
// The harness ASKS for the network poisons (`net`); `ghContainedEnv` plants none for a caller that does not, because
// suites run a functional curl outside `harnessBin` (unconditional, it measured 91 reds in three files). The bus
// rides `systemd`: the managers are what read it. A functional stub goes through `stubContainedTool`.
describe('the harness contains ssh, scp, curl and the user bus too (wave 18)', () => {
  const BUS = (home: string): string =>
    `${path.join(home, 'no-runtime-dir')}|unix:path=${path.join(home, 'no-bus')}`;
  const PROBE = 'echo "$XDG_RUNTIME_DIR|$DBUS_SESSION_BUS_ADDRESS"';
  const NET = ['ssh', 'scp', 'curl'] as const;

  it('H18-1 makeCcdHarness plants every CONTAINED_TOOLS poison at creation, before any env() or sh()', () => {
    // The creation-time plant is what a test that spawns with its OWN ghContainedEnv(h.home, …) inherits: it
    // prepends the same harnessBin, so the poisons are already there (while that HOME lives).
    const planted = fs.readdirSync(harnessBin(h.home)).filter((n) => (CONTAINED_TOOLS as readonly string[]).includes(n));
    expect(planted.sort()).toEqual([...CONTAINED_TOOLS].sort());
  });

  it('H18-2 the env every sh() spawns with passes assertNoRealTool, whatever PATH the caller adds', () => {
    expect(() => assertNoRealTool(h.env(), h.home)).not.toThrow();
    expect(() => assertNoRealTool(h.env({ PATH: '/usr/bin:/bin' }), h.home)).not.toThrow();
  });

  it.each(NET)('H18-3 %s resolves to harnessBin, records its argv, and refuses with 97', (t) => {
    expect(h.sh(`command -v ${t}`)).toBe(path.join(harnessBin(h.home), t));
    expect(h.sh(`${t} -o x example.invalid 2>/dev/null; echo rc=$?`)).toBe('rc=97');
    expect(fs.readFileSync(path.join(h.home, `${t}-poison`), 'utf8')).toBe('-o x example.invalid\n');
  });

  it('H18-4 every sh() re-plants a poison that is gone (a module-level harness after cleanup is that case)', () => {
    fs.rmSync(path.join(harnessBin(h.home), 'ssh'), { force: true });
    expect(h.sh('command -v ssh')).toBe(path.join(harnessBin(h.home), 'ssh'));
  });

  it('H18-5 a stub written through stubContainedTool REPLACES the curl poison and is kept across sh() calls', () => {
    stubContainedTool(h.home, 'curl', '#!/bin/sh\necho "stub: $*" >> "$HOME/curl.argv"\nexit 0\n');
    expect(h.sh('curl -s http://127.0.0.1:9/; echo rc=$?')).toBe('rc=0');
    expect(h.sh('curl -s http://127.0.0.1:9/; echo rc=$?')).toBe('rc=0');
    expect(fs.readFileSync(path.join(h.home, 'curl.argv'), 'utf8')).toBe('stub: -s http://127.0.0.1:9/\n'.repeat(2));
    expect(fs.existsSync(path.join(h.home, 'curl-poison')), 'the poison ran').toBe(false);
  });

  it('H18-6 inside sh() the user bus is the fixture pair under HOME, even when the caller names the real one', () => {
    expect(h.sh(PROBE)).toBe(BUS(h.home));
    expect(h.sh(PROBE, { XDG_RUNTIME_DIR: '/run/user/0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/0/bus' }))
      .toBe(BUS(h.home));
  });

  it('H18-7 ghContainedEnv plants the net poisons only for a caller that ASKS, and the fixture bus for every systemd caller', () => {
    // Three homes, one per option set: a poison is create-if-absent, so a shared harnessBin would carry one case's
    // plant into the next.
    const [a, b, c] = ['ccrc-contain-tmux-only-', 'ccrc-contain-managers-', 'ccrc-contain-net-'].map((p) => mkTmp(p));
    const real = { PATH: '/usr/bin:/bin', XDG_RUNTIME_DIR: '/run/user/0', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/0/bus' };
    const tmuxOnly = ghContainedEnv(a!, real, { tmux: true });
    for (const t of NET) expect(fs.existsSync(path.join(harnessBin(a!), t)), t).toBe(false);
    expect(tmuxOnly['XDG_RUNTIME_DIR'], 'no systemd, no bus').toBe('/run/user/0');
    const managers = ghContainedEnv(b!, real, { systemd: true, tmux: true });
    for (const t of NET) expect(fs.existsSync(path.join(harnessBin(b!), t)), t).toBe(false);
    expect(`${managers['XDG_RUNTIME_DIR']}|${managers['DBUS_SESSION_BUS_ADDRESS']}`, 'the bus rides systemd').toBe(BUS(b!));
    const net = ghContainedEnv(c!, real, { net: true });
    for (const t of NET) expect(fs.existsSync(path.join(harnessBin(c!), t)), t).toBe(true);
    expect(fs.existsSync(path.join(harnessBin(c!), 'systemctl')), 'net is not systemd').toBe(false);
    expect(net['XDG_RUNTIME_DIR'], 'net is not the bus').toBe('/run/user/0');
  });

  it('H18-8 a bus pair the caller points under HOME stands; a pair only half under HOME does not', () => {
    const own = {
      XDG_RUNTIME_DIR: path.join(h.home, 'xdg'),
      DBUS_SESSION_BUS_ADDRESS: `unix:path=${path.join(h.home, 'xdg', 'bus')}`,
    };
    expect(h.sh(PROBE, own)).toBe(`${own.XDG_RUNTIME_DIR}|${own.DBUS_SESSION_BUS_ADDRESS}`);
    expect(h.sh(PROBE, { ...own, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/0/bus' })).toBe(BUS(h.home));
  });

  it('H18-9 stubContainedTool is the one named door: it writes into harnessBin and refuses a name it does not contain', () => {
    expect(() => stubContainedTool(h.home, 'git' as never, '#!/bin/sh\n')).toThrow(/not a contained tool/);
    // gh is contained, but its poison is rewritten on every ghContainedEnv call, so this door would not keep it (D-5254).
    expect(() => stubContainedTool(h.home, 'gh' as never, '#!/bin/sh\n')).toThrow(/GH_STUB/);
    const p = stubContainedTool(h.home, 'ssh', '#!/bin/sh\necho stub-ssh\n');
    expect(p).toBe(path.join(harnessBin(h.home), 'ssh'));
    expect(h.sh('ssh')).toBe('stub-ssh');
  });
});
