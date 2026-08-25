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
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
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

describe('the placement must land in the fleet slice, or the ceiling stops applying (D-307 (was D-B8-11))', () => {
  // D-303 (was D-B8-7) gave the tmux server a scope of its own and, in doing so, moved the
  // whole fleet's workload out of the cgroup the memory ceiling is attached to.
  // Ubuntu's tmux is built with systemd support: it mints a transient
  // `tmux-spawn-<uuid>.scope` per pane and derives that scope's SLICE from its
  // own placement, so the panes go wherever the server went. `systemd-run`
  // defaults a user scope to `app.slice`; the ceiling lives one level in.
  //
  // Measured on the fleet host 2026-08-19, after the reboot that verified D-305 (was D-B8-9):
  //
  //   app-claude\x2dsession.slice     66 MB   cap 20G/24G   <- only the supervise loops
  //   app.slice                     17.6 GB   cap infinity  <- all 17 panes
  //
  // and proved causal the same day on an isolated socket: a server started
  // inside `app-claude\x2dsession.slice` mints its pane scope in that same
  // slice. One `--slice=` restores it.
  //
  // The ceiling is not decoration. It was added 2026-07-28 after one pane
  // peaked at 24G and stalled the fleet for ~25 minutes, and the per-scope cap
  // `ccd-cap-scopes` applies is 12G — three sessions at their own cap overrun
  // this 30G box, which is precisely what an AGGREGATE limit exists to stop.
  //
  // The slice is named ABSOLUTELY rather than inherited from the caller. Every
  // caller's cgroup is a different answer — `cmd_supervise`'s unit, an
  // interactive shell, a transient `systemd-run` from the auto-swap — and
  // "wherever the creator happened to be" is the exact defect D-303 removed.

  /** The slice carrying the aggregate ceiling, DERIVED from the drop-in the
   *  deploy installs rather than typed a second time here. systemd escapes a
   *  literal `-` inside a unit name as `\x2d`; that escape is the only
   *  difference between the readable repo directory and the unit name, and
   *  getting it wrong means systemd silently never reads the drop-in. */
  const fleetSlice = (): string => {
    const dirs = fs.readdirSync(path.resolve(__dirname, '../../deploy/systemd'))
      .filter((d) => d.endsWith('.slice.d'));
    expect(dirs, 'deploy/systemd must carry exactly one slice drop-in for this to be derivable')
      .toHaveLength(1);
    const m = /^app-(.+)\.slice\.d$/.exec(dirs[0]!);
    expect(m, `unexpected slice drop-in directory name: ${dirs[0]}`).toBeTruthy();
    return `app-${m![1]!.replace(/-/g, '\\x2d')}.slice`;
  };

  it('names the slice the deploy attaches the ceiling to', () => {
    h.sh(`${TMUX_NO_SERVER} _tmux_new_session -d -s cc-demo 'true'`, { SYSTEMD_RUN_RC: '0' });
    const [argv] = h.systemdRunCalls();
    expect(argv,
      'without --slice the scope defaults to app.slice, and every pane scope tmux mints '
      + 'follows it out of the fleet memory ceiling')
      .toContain(`--slice=${fleetSlice()}`);
  });

  it('the derivation is real: it reads the escaped slice name off the deploy tree', () => {
    expect(fleetSlice()).toBe('app-claude\\x2dsession.slice');
  });

  it('the slice it names carries a real ceiling — an uncapped one makes the placement pointless', () => {
    const conf = readFileSync(
      path.resolve(__dirname, '../../deploy/systemd/app-claude-session.slice.d/limits.conf'), 'utf8');
    expect(conf).toMatch(/^\[Slice\]$/m);
    expect(conf, 'a hard aggregate ceiling is the whole point of placing the server here')
      .toMatch(/^MemoryMax=\d+[GM]$/m);
    expect(conf, 'the soft ceiling is what throttles before the hard one kills')
      .toMatch(/^MemoryHigh=\d+[GM]$/m);
  });
});

describe('the boot race — 17 supervisors, one server (D-303, second attempt)', () => {
  // WHAT ACTUALLY HAPPENED, measured on the fleet host after the second reboot.
  // All 17 units start in the same second, all see no server, all call
  // `systemd-run --scope --unit=ccrc-tmux-server`. One wins the unit name; the
  // journal shows the other 15 refused with "Unit ccrc-tmux-server.scope was
  // already loaded or has a fragment file" — AND THEY DID NOT WAIT. Each fell
  // through to a bare `new-session`, one of THOSE created the server in its own
  // `claude-session@…` cgroup, and the scope winner's `new-session` then merely
  // connected to it, leaving the scope empty for `--collect` to reap.
  //
  // The first fix reasoned that a loser's fallback would attach to a server the
  // winner had already placed. Losing a unit-name race says nothing about who
  // reaches `new-session` first. These tests pin the serialisation that makes
  // the ordering true instead of assumed.

  it('runs the create path exactly ONCE across concurrent callers', () => {
    const h = makeCcdHarness('ccrc-ccd-tmuxrace-');
    // A tmux stub with REAL shared state: `list-sessions` answers from a file
    // that `new-session` creates. That is what makes this a race test rather
    // than a stub-ordering test — remove the lock and the count goes up.
    // The `sleep 0.2` inside the create widens the window the lock closes; it
    // is the difference between "usually passes" and "measures the thing".
    h.sh(`cat > "$HOME/tmuxstub" <<'EOS'
tmux() {
  case "$1" in
    list-sessions) [ -f "$HOME/server-up" ] ;;
    new-session)   if [ ! -f "$HOME/server-up" ]; then
                     sleep 0.2; echo create >> "$HOME/creates"; : > "$HOME/server-up"
                   else echo attach >> "$HOME/attaches"; fi ;;
    *) : ;;
  esac
}
EOS
      :`);
    const script =
      'source "$HOME/tmuxstub";'
      + ' for i in $(seq 1 8); do ( _tmux_new_session -d -s cc-$i "true" ) & done; wait';
    // NO SYSTEMD_RUN_RC=0 here: at rc 0 the contained `systemd-run` records its
    // argv and returns WITHOUT exec'ing it, so no tmux would run and the test
    // would measure nothing. Letting it refuse (the default 97) sends every
    // caller down the bare-create path — which is the path that raced.
    h.sh(script);
    const creates = fs.existsSync(path.join(h.home, 'creates'))
      ? fs.readFileSync(path.join(h.home, 'creates'), 'utf8').split('\n').filter(Boolean) : [];
    expect(creates,
      'more than one caller created the server — the losers raced ahead instead of waiting, which is'
      + ' exactly the boot failure this lock exists to prevent')
      .toHaveLength(1);
    h.cleanup();
  });

  it('takes the lock only when no server is running — the hot path stays lock-free', () => {
    const h = makeCcdHarness('ccrc-ccd-tmuxlock-');
    // Every spawn after the first must not serialise on a box-wide lock. If the
    // lock file is never created, nothing contended for it.
    h.sh(`${TMUX_SERVER_UP} _tmux_new_session -d -s cc-demo 'true'`);
    expect(fs.existsSync(path.join(h.home, '.cc-sessions', '.tmux-server.lock')),
      'the fast path opened the box-wide lock; every spawn on the box would then serialise on it')
      .toBe(false);
    h.cleanup();
  });

  it('still creates the session when flock is unavailable — degraded, never absent', () => {
    const h = makeCcdHarness('ccrc-ccd-tmuxnoflock-');
    // The single-box OSS story again. Without flock the serialisation is
    // ABSENT, not broken: the worst case is the pre-lock behaviour, a possibly
    // misplaced server — never a session that does not exist.
    h.sh(`${TMUX_NO_SERVER}
          command() { if [[ "$1 $2" == "-v flock" ]]; then return 1; fi; builtin command "$@"; }
          _tmux_new_session -d -s cc-demo 'true'`);
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
    h.cleanup();
  });

  it('waits rather than refusing — the lock is blocking, and `-n` would reproduce the bug', () => {
    // ccd's three other flock sites pass `-n` on purpose. This one must not:
    // a refused loser proceeds immediately, which is precisely how 15 losers
    // raced ahead of the scope winner at boot.
    const src = readFileSync(CCD, 'utf8');
    const line = src.split('\n').filter((l) => l.includes('flock -w') && l.includes('TMUX_SERVER_LOCK_WAIT'));
    expect(line, 'the tmux-server lock must be a BOUNDED BLOCKING acquire').toHaveLength(1);
    expect(line[0], 'a `-n` acquire here reproduces the boot race the lock exists to close')
      .not.toMatch(/flock\s+-n/);
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
