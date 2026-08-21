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
  makeCcdHarness, harnessBin, ghContainedEnv, WS_ADD, type ContainOpts, type CcdHarness,
} from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

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
    h.sh('systemctl --user enable --now claude-session@demo-quiet-basin 2>/dev/null; :');
    expect(h.systemctlCalls()).toEqual(['--user enable --now claude-session@demo-quiet-basin']);
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
   *  the top: the scan's window is only 12 lines back from the spawn it reads.
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
});
