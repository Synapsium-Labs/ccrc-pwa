// server/test/ccd-tmux-server.test.ts
//
// All 21 live sessions are children of ONE tmux server, and that server
// currently sits inside `claude-session@claude-ccrc-pwa.service`'s cgroup —
// whichever unit happened to create it. The unit file carries KillMode=process
// for exactly that reason, and one deleted line would turn the deploy's
// `try-restart claude-session@*` sweep into a fleet kill.
//
// This puts the SERVER in a scope of its own the next time one is created. It
// cannot move a live server: cgroup membership of a running process needs a
// D-Bus StartTransientUnit adoption, and that is not something to attempt
// against a process holding 21 sessions. So it takes effect at the next
// reboot, and it self-heals from then on.
//
// FIXTURE HOME ONLY — never the live box. The recording systemctl/systemd-run
// from ccdWsHelpers.ts is what makes the second half assertable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-tmuxsrv-'); });
afterEach(() => { h.cleanup(); });

describe('_tmux_server_ensure', () => {
  it('is a NO-OP when a server is already running', () => {
    h.sh('tmux() { case "$1" in list-sessions) return 0 ;; esac; }; _tmux_server_ensure');
    expect(h.systemdRunCalls()).toEqual([]);
  });

  it('places a NEW server in ccrc-tmux-server.scope, outside any claude-session@ cgroup', () => {
    h.sh('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 1 ;; esac; };'
       + ' _tmux_server_ensure; :');
    const [argv] = h.systemdRunCalls();
    expect(argv).toContain('--user --scope');
    expect(argv).toContain('--unit=ccrc-tmux-server');
    expect(argv).toContain('tmux start-server');
    expect(argv).not.toContain('claude-session@');
  });

  it('falls back to a bare `tmux start-server` when systemd-run refuses', () => {
    // The single-box OSS story: ccd must keep working with no systemd at all.
    // The harness poison ALREADY exits 97, so no override is needed — and a
    // `systemd-run() { … }` shell function would be a bash-only name and would
    // shadow the very boundary this suite is here to exercise.
    h.sh('tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 1 ;; esac; };'
       + ' _tmux_server_ensure; :');
    expect(h.calls()).toContain('tmux start-server');
  });

  it('_spawn_start calls it BEFORE new-session — a server created by the spawn is already scoped', () => {
    h.sh(`_reg_set myid wrapper claude
          _reg_set myid workdir '${h.home}'
          _reg_set myid uuid deadbeef
          tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 1 ;; esac; }
          _spawn_start myid new`);
    const calls = h.calls();
    const start = calls.findIndex((c) => c === 'tmux start-server');
    const news  = calls.findIndex((c) => c.startsWith('tmux new-session'));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(news).toBeGreaterThan(start);
  });
});
