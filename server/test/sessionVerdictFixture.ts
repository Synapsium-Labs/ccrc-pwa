/**
 * The `tmux has-session` failure-message table, as DATA — the single source of
 * truth both `_session_verdict` (bash, driven by `ccd-session-verdict.test.ts`)
 * and `classifyHasSession` (TS, driven by `exec.test.ts`) are tested against.
 * Two hand-written lists is exactly the drift the architecture doc's
 * cross-language fixture-test idiom exists to stop (`sessionLifecycleFixture.ts`
 * is the same mechanism over the lifecycle ladder, and D-B8-13 is the deviation
 * that made the twins twins: the server's `Tmux.hasSession` carried the same
 * collapse D-B8-12 removed from ccd, one seam over).
 *
 * Rows are stated in the one vocabulary both sides share: the MESSAGE the tmux
 * client printed on stderr when `has-session` exited non-zero. The TS side has
 * distinctions bash never sees (`killed`, `signal`, a link failure synthesized
 * by `remote/runner.ts`) — those cases live in `exec.test.ts` alone, and every
 * one of them must answer `unknown`, so they extend this table's polarity
 * rather than escaping it.
 *
 * THE POLARITY IS THE WHOLE DESIGN (D-B8-12): recognise the ONE message that
 * means death, call everything else unknown. Adding a row with
 * `expected: 'gone'` for any message other than tmux's own "can't find
 * session" is the mistake this table exists to make loud.
 */

export interface VerdictFixtureRow {
  /** Doubles as the `it` title in both suites. */
  readonly name: string;
  /** What the tmux client printed on stderr, verbatim shapes from the real
   *  binary (measured 2026-08-19 on an isolated socket, all at rc=1). */
  readonly message: string;
  readonly expected: 'gone' | 'unknown';
}

export const VERDICT_MESSAGE_ROWS: readonly VerdictFixtureRow[] = [
  {
    name: 'gone: the one message that actually means the session died',
    message: "can't find session: cc-demo",
    expected: 'gone',
  },
  {
    name: 'unknown: the socket is not there',
    message: 'error connecting to /tmp/tmux-1000/default (No such file or directory)',
    expected: 'unknown',
  },
  {
    name: 'unknown: the socket is there but nothing is serving it',
    message: 'no server running on /tmp/tmux-1000/default',
    expected: 'unknown',
  },
  {
    name: 'unknown, NOT gone: protocol skew — the motivating fault of the whole design',
    message: 'protocol version mismatch (client 8, server 7)',
    expected: 'unknown',
  },
  {
    name: 'unknown, NOT gone, for a message this build has never seen — the fail-safe direction',
    message: 'some error nobody has written yet',
    expected: 'unknown',
  },
];
