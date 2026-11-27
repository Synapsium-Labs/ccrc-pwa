// The off switch works at once for the hook in go mode (Go core wave 2, Task 9a fix round 1, F3). settings.json registers
// the core's command until the installer next runs, so the core itself reads `ccd-go-off` at entry and, when a `hook`
// line (or an empty or unreadable file) sends the hook back to bash, hands THIS call to the bash hook: its stdin,
// environment and status. Measured with a stand-in at `~/.cc-sessions/session-hook.sh` that records what it was given.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inheritedEnv } from './gitEnvStrip.js';
import { HARNESS_BASH } from './ccdWsHelpers.js';
import { hookEnv, runHook, type HookFixture } from './hookTwin.js';
import { mkTmp } from './tmpHelpers.js';

let h: HookFixture;
const off = () => path.join(h.home, '.cc-sessions', 'ccd-go-off');
const stand = () => path.join(h.home, '.cc-sessions', 'session-hook.sh');
const seen = () => path.join(h.home, 'stand-in.stdin');
const PAYLOAD = { hook_event_name: 'Stop', session_id: 's1', cwd: '/w' };
beforeEach(() => {
  const home = mkTmp('ccrc-hook-off-');
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  h = { home, env: (extra = {}) => ({ ...inheritedEnv(), HOME: home, ...extra }) };
  fs.writeFileSync(stand(), '#!/bin/bash\ncat > "$HOME/stand-in.stdin"\necho "bash-hook:${CCRC_PROBE-unset}"\necho stand-in-err >&2\nexit 7\n', { mode: 0o755 });
});
const goes = (env: NodeJS.ProcessEnv = {}) => runHook(h, 'go', PAYLOAD, env);
const handedToBash = (r: { status: number | null; stdout: string; stderr: string }, probe = 'unset') => {
  expect(r.status).toBe(7);
  expect(r.stdout).toBe(`bash-hook:${probe}\n`);
  expect(r.stderr).toBe('stand-in-err\n');
  expect(JSON.parse(fs.readFileSync(seen(), 'utf8'))).toEqual(PAYLOAD);
};

describe('the core hook reads ccd-go-off at entry', () => {
  it('with no switch file the core runs: no session, so exit 0 and nothing printed, and the stand-in is not run', () => {
    expect(goes()).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(fs.existsSync(seen())).toBe(false);
  });
  it('a `hook` line hands the call to the bash hook at once: stdin, environment and exit status pass through', () => {
    fs.writeFileSync(off(), 'caps\nhook\n');
    handedToBash(goes({ CCRC_PROBE: 'kept' }), 'kept');
  });
  it('an empty file, a BOM and CRLF, and a line that is no verb word all hand it over', () => {
    for (const body of ['', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hook\r\n')]), 'caps\nNot A Verb\n']) {
      fs.rmSync(seen(), { force: true });
      fs.writeFileSync(off(), body);
      handedToBash(goes());
    }
  });
  it('a file naming other verbs only leaves the hook on the core', () => {
    fs.writeFileSync(off(), 'caps\nlist\n');
    expect(goes()).toEqual({ status: 0, stdout: '', stderr: '' });
    expect(fs.existsSync(seen())).toBe(false);
  });
  it.skipIf(process.platform === 'win32')('a link, a directory or a FIFO at the file is off, and never opened', () => {
    const named = path.join(h.home, 'target');
    fs.writeFileSync(named, 'caps\n');
    for (const make of [() => fs.symlinkSync(named, off()), () => fs.mkdirSync(off()), () => { expect(spawnSync('mkfifo', [off()]).status).toBe(0); }]) {
      fs.rmSync(off(), { recursive: true, force: true });
      make();
      handedToBash(goes());
    }
  });
  it('off with no bash hook there answers what the bash mode\'s registered command answers: bash\'s 127, its message on stderr (N5)', () => {
    fs.writeFileSync(off(), 'hook\n');
    fs.rmSync(stand());
    const env = hookEnv(h);
    const bashMode = spawnSync(HARNESS_BASH, ['-c', 'bash "$HOME/.cc-sessions/session-hook.sh"'], { env, encoding: 'utf8', input: '{}' });
    expect(bashMode.status).toBe(127);
    const r = goes();
    expect({ status: r.status, stdout: r.stdout }).toEqual({ status: 127, stdout: '' });
    expect(r.stderr).toMatch(/session-hook\.sh: No such file or directory/);
  });
  it('a bash hook killed by a signal is 128+n, as a shell answers it, never 255: the status the bash mode command answers (N4)', () => {
    fs.writeFileSync(off(), 'hook\n');
    fs.writeFileSync(stand(), '#!/bin/bash\nkill -TERM $$\n', { mode: 0o755 });
    const bashMode = spawnSync(HARNESS_BASH, ['-c', 'bash "$HOME/.cc-sessions/session-hook.sh"'], { env: hookEnv(h), encoding: 'utf8' });
    // On Windows the bash mode's command hands a native caller MSYS2's raw signal status (TERM shifted left 8: 3840),
    // which the core, itself behind MSYS2's bash, cannot pass (8 bits: 0, a success); it answers 128+n
    // (D-TBD-go-hook-off-status).
    // Elsewhere `bash -c 'bash …'` execs the inner bash, so the caller sees the TERM itself (status null).
    const bash = process.platform === 'win32' ? bashMode.status : (bashMode.status ?? `signal ${bashMode.signal}`);
    expect({ bash, go: goes().status }).toEqual({ bash: process.platform === 'win32' ? 3840 : 'signal SIGTERM', go: 143 });
  });
});
