// server/test/ccd-tmux-server.test.ts
//
// Every session on this box is a child of ONE tmux server, and that server
// lives in whichever cgroup happened to create it. The unit file carries
// KillMode=process for exactly that reason, and one deleted line would turn
// the deploy's `try-restart claude-session@*` sweep into a fleet kill. The
// mechanism here places the server deliberately instead.
//
// THIS SUITE WAS REWRITTEN AFTER THE MECHANISM IT PINNED WAS MEASURED DOING
// NOTHING, and that is the part worth reading. The previous version asserted
// that `_tmux_server_ensure` ran `systemd-run --scope … tmux start-server`,
// that it was skipped when a server existed, that its `||` fallback fired on
// refusal and did NOT fire on success. Every one of those assertions was true,
// well-argued, mutation-proof — and green while the design achieved nothing,
// because a tmux server with NO SESSIONS exits immediately. `start-server`
// left nothing behind, the scope collected, and the next `tmux new-session`
// made a fresh server in the caller's cgroup.
//
// Measured on the fleet host after the planned reboot (2026-08-18): the server
// sat in `claude-session@ccrc-pwa-calm-mesa.service`, one unit over from where
// it began, and `ccrc-tmux-server.scope` did not exist. The suite could not
// have caught it: with `tmux` stubbed, no assertion about argv can observe
// that the real binary exits. So this version adds the one thing that WOULD
// have caught it — a test that the scope wraps the session-creating call
// rather than a separate `start-server` — and states the lifeline rule in
// words, because that rule is the whole reason the shape is what it is.
//
// FIXTURE HOME ONLY — never the live box. The recording systemctl/systemd-run
// from ccdWsHelpers.ts is what makes any of this assertable.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { CCD, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-tmuxsrv-'); });
afterEach(() => { h.cleanup(); });

/** `tmux` stub: records every call, and reports "no server" so the placement
 *  branch is taken. `new-session` succeeds, as the real one does. */
const TMUX_NO_SERVER =
  'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 1 ;; esac; };';
const TMUX_SERVER_UP =
  'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in list-sessions) return 0 ;; esac; };';

describe('_tmux_new_session', () => {
  it('does NOT reach for a scope when a server is already running', () => {
    // The server is already placed — wherever that is, a second scope cannot
    // move it, and asking systemd for one per spawn would be pure noise.
    h.sh(`${TMUX_SERVER_UP} _tmux_new_session -d -s cc-demo 'true'`);
    expect(h.systemdRunCalls()).toEqual([]);
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
  });

  it('wraps the SESSION-CREATING call in the scope — not a separate start-server', () => {
    // THE REGRESSION TEST FOR THE DEFECT THIS FILE'S HEADER DESCRIBES. A tmux
    // server with no sessions exits, so a scope around `start-server` places
    // nothing; the scope has to wrap the call that creates the first session,
    // because that session is what keeps the server alive.
    h.sh(`${TMUX_NO_SERVER} _tmux_new_session -d -s cc-demo 'true'`, { SYSTEMD_RUN_RC: '0' });
    const [argv] = h.systemdRunCalls();
    expect(argv, 'the scope must wrap `tmux new-session`').toContain('tmux new-session');
    expect(argv, 'a scope around `start-server` places nothing: a session-less server exits immediately')
      .not.toContain('start-server');
    expect(argv).toContain('--user --scope');
    expect(argv).toContain('--unit=ccrc-tmux-server');
    expect(argv).not.toContain('claude-session@');
  });

  it('passes the caller argv through to the scoped tmux verbatim', () => {
    // The wrapper takes `new-session`'s arguments, so a dropped or reordered
    // flag would create a session of the wrong geometry, or none at all.
    h.sh(`${TMUX_NO_SERVER} _tmux_new_session -d -s cc-demo -x 220 -y 50 'true'`,
      { SYSTEMD_RUN_RC: '0' });
    const [argv] = h.systemdRunCalls();
    expect(argv).toContain('tmux new-session -d -s cc-demo -x 220 -y 50 true');
  });

  it('creates the session bare when systemd-run refuses — a missing session is worse than a misplaced one', () => {
    // The single-box OSS story: ccd must keep working with no systemd at all.
    // The harness poison already exits 97, so no override is needed.
    h.sh(`${TMUX_NO_SERVER} _tmux_new_session -d -s cc-demo 'true'`);
    expect(h.systemdRunCalls().length).toBeGreaterThan(0);
    expect(h.calls()).toContain('tmux new-session -d -s cc-demo true');
  });

  it('does NOT create a second session when the scoped call SUCCEEDS', () => {
    // The negative control for the fallback. With a poison that can only fail,
    // "try scoped, else bare" is indistinguishable from "scoped, then bare" —
    // and a second `new-session` on a live name is a duplicate-name error that
    // would turn a working spawn into a failed one. $SYSTEMD_RUN_RC makes the
    // success branch expressible.
    h.sh(`${TMUX_NO_SERVER} _tmux_new_session -d -s cc-demo 'true'`, { SYSTEMD_RUN_RC: '0' });
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toEqual([]);
  });

  it('runs the bare call exactly ONCE when there is no systemd-run to try', () => {
    // No scope was attempted, so there is nothing to fall back FROM. Retrying
    // here would hit a duplicate name and report a confusing second failure
    // for a session that had already failed on its own merits.
    h.sh(`${TMUX_NO_SERVER}
          systemd-run() { return 127; }
          command() { if [[ "$1 $2" == "-v systemd-run" ]]; then return 1; fi; builtin command "$@"; }
          _tmux_new_session -d -s cc-demo 'true'`);
    expect(h.calls().filter((c) => c.startsWith('tmux new-session'))).toHaveLength(1);
  });
});

describe('_spawn_start routes its session creation through the placement wrapper', () => {
  it('creates its session via _tmux_new_session, so a spawn-created server is scoped', () => {
    h.sh(`_reg_set myid wrapper claude
          _reg_set myid workdir '${h.home}'
          _reg_set myid uuid deadbeef
          ${TMUX_NO_SERVER}
          _spawn_start myid new`, { SYSTEMD_RUN_RC: '0' });
    const [argv] = h.systemdRunCalls();
    expect(argv, 'the spawn must create its session inside the scope').toContain('tmux new-session');
    expect(argv).toContain('--unit=ccrc-tmux-server');
  });

  it('no bare `tmux new-session` survives in _spawn_start — every path goes through the wrapper', () => {
    // Structural, because the two call sites are easy to add a third beside.
    // A bare one would place the server in the caller's cgroup on whichever
    // path took it, which is the original flaw re-entering by the side door.
    const body = h.sh('type _spawn_start');
    expect(body, 'a bare `tmux new-session` in _spawn_start places the server in the caller\'s cgroup — use _tmux_new_session')
      .not.toMatch(/(^|[^_\w])tmux new-session/);
  });
});

describe('the old shape is gone from the CODE, and stays named in the comments', () => {
  // SCANS CODE ONLY, and the distinction is the point rather than a
  // convenience. `ccd/ccd` deliberately keeps the old name and the old
  // `systemd-run … start-server` pairing in its comments — that is the history
  // of a mechanism that looked right and did nothing, and this repo's rule is
  // to read such comments as authoritative history rather than delete them.
  // A scanner that cannot tell a comment from a line of shell would force the
  // history out to stay green, which is the wrong trade and cost this suite
  // two red runs while it was being written. Full-line `#` is enough here:
  // both greps below are checked against the real file, where every surviving
  // mention sits on its own comment line.
  const codeLines = readFileSync(CCD, 'utf8').split('\n')
    .filter((l) => !l.trim().startsWith('#'));

  it('`_tmux_server_ensure` is not called or defined anywhere in ccd', () => {
    // It was measured doing nothing. Leaving a live name behind invites a
    // caller that believes the placement happened.
    expect(codeLines.filter((l) => l.includes('_tmux_server_ensure'))).toEqual([]);
  });

  it('ccd never wraps a scope around a session-less `start-server`', () => {
    // The defect in one line: this exact pairing places nothing, because the
    // server it starts has no session to keep it alive.
    expect(
      codeLines.filter((l) => l.includes('systemd-run') && l.includes('start-server')),
      'a session-less tmux server exits immediately, so this scope collects and places nothing',
    ).toEqual([]);
  });
});
