/**
 * THE COLD-START TRAP (D-514, incident 2026-08-26, fleet host).
 *
 * An OOM killed the tmux server. Every `_session_probe` then read
 * `no server running on /tmp/tmux-1000/default`, which is `unknown` — correctly,
 * and that classification must not change (see below). But `cmd_supervise`'s
 * pre-flight skipped `cmd_ensure` on `unknown`, and the watch loop's `unknown`
 * arm has no exit: it marks, stamps and backs off forever. All 18 units reported
 * `active` for 4.5 hours while nothing ran, which is why nothing alerted.
 *
 * Recovery required a human running a bare `tmux new-session`, which bypasses
 * `_tmux_new_session` and births the server in the caller's cgroup rather than
 * `ccrc-tmux-server.scope` — so every pane inherited an uncapped location and the
 * aggregate ceiling covered nothing. Measured that morning: the slice held 78MB
 * against Max=24G while all 18 pane scopes sat directly under `user@1000.service`.
 * The next OOM then killed the supervision layer (panes carry
 * `oom_score_adj=-900`, so the kernel could not touch the offenders) and took the
 * tmux server with it — back into the trap.
 *
 * `_tmux_new_session`'s own comment — "it self-heals whenever the server is next
 * created" — is the assumption this falsifies: it holds only while ccd is the
 * creator, and the trap is precisely what made a human the creator.
 *
 * THE FIX IS NOT A NEW `gone` ARM, AND THIS SUITE EXISTS PARTLY TO SAY SO.
 * `sessionVerdictFixture.ts` pins `no server running` as `unknown` on purpose:
 * `_ws_status` turns `gone` into `idle`, `ws-archive` and `ws-reap` gate on
 * `idle`, and `cmd_forget` proves deadness with `! _alive || die` — so mapping
 * absence to `gone` would present every live session as reapable during a cold
 * start and let `forget` purge live registry rows (D-308/D-309). Instead
 * `_session_probe` publishes a SECOND, independent fact — `PROBE_SUBSTRATE` —
 * that exactly one caller reads.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { VERDICT_MESSAGE_ROWS } from './sessionVerdictFixture.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-coldstart-'); });
afterEach(() => { h.cleanup(); });

/** `has-session` fails with a chosen message — the real binary's shape for each
 *  of these conditions (measured on tmux 3.4, all at rc 1). */
const saying = (msg: string): string =>
  `tmux() { case "$1" in has-session) echo "${msg}" >&2; return 1 ;; esac; return 0; };`;

/** rc 124 with NOTHING on stderr: `timeout`'s own kill against a wedged socket.
 *  The one shape the pre-flight was originally written to refuse. */
const WEDGED = `tmux() { case "$1" in has-session) return 124 ;; esac; return 0; };`;

const substrate = (stub: string): string =>
  h.sh(`${stub} _session_probe demo; echo "$PROBE_VERDICT/$PROBE_SUBSTRATE"`).trim();

describe('_session_probe publishes whether a SERVER exists, beside whether a SESSION does', () => {
  it.each([
    ['a socket with nobody serving it', 'no server running on /tmp/tmux-1000/default'],
    ['no socket at all — the cold-boot shape', 'error connecting to /tmp/tmux-1000/x (No such file or directory)'],
  ])('absent: %s', (_name, msg) => {
    expect(substrate(saying(msg))).toBe('unknown/absent');
  });

  it.each([
    // A server IS running in both of these — it answered, it just did not answer
    // usefully. Neither is evidence of absence, and creating a second server on
    // top of a live one is the last thing either wants.
    ['protocol skew', 'protocol version mismatch (client 8, server 7)'],
    ['the socket is there and refuses us', 'error connecting to /tmp/tmux-1000/default (Permission denied)'],
    ['a message this build has never seen', 'some error nobody has written yet'],
  ])('unmeasured, NOT absent: %s', (_name, msg) => {
    expect(substrate(saying(msg))).toBe('unknown/unmeasured');
  });

  it('unmeasured: the wedge — rc 124, tmux printed nothing at all', () => {
    expect(substrate(WEDGED)).toBe('unknown/unmeasured');
  });

  it('present: the server answered, whatever it said about the session', () => {
    expect(substrate(`tmux() { return 0; };`)).toBe('live/present');
    expect(substrate(saying("can't find session: cc-demo"))).toBe('gone/present');
  });

  // D-516 — THE NEAR-MISS THIS COST ME ONCE. `PROBE_SUBSTRATE` is a global that outlives
  // the call, so a classification guarded on "only if unset" would carry the
  // previous probe's answer forward. Probe an absent server, then a live-but-
  // skewed one, in ONE shell: the second answer must be the second server's.
  //
  // BOTH PROBES MUST REACH THE CLASSIFICATION for this to measure anything —
  // which is why the second one is protocol skew and NOT the wedge. The wedge
  // returns early from the rc-124 branch, which assigns unconditionally, so a
  // wedge-second version of this test passes with the stale-global bug present
  // (measured: it did).
  it('does not carry a previous probe\'s substrate answer into the next', () => {
    const out = h.sh(`${saying('no server running on /tmp/x')} _session_probe demo
      first="$PROBE_SUBSTRATE"
      ${saying('protocol version mismatch (client 8, server 7)')}
      _session_probe demo
      echo "$first/$PROBE_SUBSTRATE"`).trim();
    expect(out).toBe('absent/unmeasured');
  });

  // The verdict polarity is UNCHANGED by any of the above — re-asserted here off
  // the same shared table the two verdict suites use, so that a future broadening
  // of the substrate classification cannot quietly drag a verdict with it.
  it.each(VERDICT_MESSAGE_ROWS.map((r) => [r.name, r.message, r.expected] as const))(
    'verdict unchanged — %s', (_name, message, expected) => {
      expect(h.sh(`${saying(message)} _session_verdict demo`).trim()).toBe(expected);
    });
});

describe('cmd_supervise escapes a cold start, and still refuses to walk into a wedge', () => {
  /** `cmd_ensure` is stubbed to exit 7, so the pre-flight's decision is the only
   *  thing this measures. If ensure is SKIPPED, the watch loop runs — and the
   *  stub's second answer is tmux's death sentence, so the loop exits 1 rather
   *  than spinning on `unknown` forever (which is the bug itself, and would hang
   *  this suite). Exit 7 = ensured; exit 1 = skipped. */
  const supervise = (firstMessage: string, rc = 1): { code: number } => {
    h.sh(`_reg_set demo wrapper claude; _reg_set demo project demo`);
    const stub = `sleep() { :; };
      systemctl() { return 0; };
      cmd_ensure() { exit 7; };
      tmux() {
        case "$1" in
          has-session)
            if [[ -e "$HOME/probed" ]]; then echo "can't find session: cc-demo" >&2; return 1; fi
            touch "$HOME/probed"
            ${firstMessage ? `echo "${firstMessage}" >&2;` : ''} return ${rc} ;;
          capture-pane) printf '' ;;
        esac
        return 0
      };`;
    try {
      h.sh(`${stub} cmd_supervise demo`);
      return { code: 0 };
    } catch (e) {
      return { code: (e as { status?: number }).status ?? 1 };
    }
  };

  it('an ABSENT server reaches cmd_ensure — which is what puts the new server in ccrc-tmux-server.scope', () => {
    // The whole point: `cmd_ensure` -> `_spawn_start` -> `_tmux_new_session`,
    // which is the ONLY creator that places the server in the capped scope.
    expect(supervise('no server running on /tmp/tmux-1000/default').code).toBe(7);
  });

  it('no socket at all reaches it too — the shape a reboot leaves behind', () => {
    expect(supervise('error connecting to /tmp/tmux-1000/default (No such file or directory)').code).toBe(7);
  });

  it('a WEDGED server still does NOT — `new-session` carries no deadline and would block forever', () => {
    // The protection the pre-flight was written for, and the reason this fix is
    // `absent` rather than "any unknown". If this ever goes red, the escape has
    // been broadened into the hang it was carved around.
    expect(supervise('', 124).code).toBe(1);
  });

  it('a server that answered unusefully still does NOT — skew is not absence', () => {
    expect(supervise('protocol version mismatch (client 8, server 7)').code).toBe(1);
  });
});
