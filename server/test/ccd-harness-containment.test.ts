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
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, harnessBin, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

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
