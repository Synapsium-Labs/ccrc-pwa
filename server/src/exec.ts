import { execFile } from 'node:child_process';

/**
 * THE VOCABULARY FOR "WE DID NOT MEASURE THIS", stated once here and used
 * unchanged at every seam that needed it (§1.7). Two shapes, and which one a
 * field gets is decided by whether the field can be absent at all:
 *
 *   • OPTIONAL field on a record that crosses a version boundary — ABSENCE is
 *     the unmeasured answer, presence is a measurement. `ExecResult.killed` and
 *     `ExecResult.signal` below: an older agent omits them, and absence-permits
 *     is the wire rule (`shared/api.ts`, additive-only). A present `null` on
 *     `signal` is a MEASUREMENT — "it died of no signal" — and is not the same
 *     fact as the key being missing.
 *   • REQUIRED field, where absence is not spellable — unmeasured gets its OWN
 *     TOKEN, `UNMEASURED`, which is never a member of the measured domain.
 *     `CcdResult.killed`/`.signal` (`lifecycle.ts`) take this shape.
 *
 * The rule both shapes serve: a caller that handles "false" differently from "we
 * do not know" must never receive the same value for both. The third face of the
 * same rule lives at the render seam — a value this build cannot NAME is shown
 * as itself, never as a member it is not (`SessionLine.tsx`'s spawn chip).
 */
export const UNMEASURED = 'unmeasured';
export type Unmeasured = typeof UNMEASURED;

/** `killed` is OPTIONAL and that is not a style choice: 249 bare
 *  `{code, stdout, stderr}` literals across 32 test files make a required field
 *  a suite-wide break. Absence means UNMEASURED — what an older agent sends, and
 *  the safe direction (§1.5 never adopts on it).
 *
 *  `signal` is the SECOND half of the same measurement and is not derivable from
 *  the first: node sets `error.killed` true only when IT killed the child, so a
 *  child killed by an EXTERNAL signal (an operator `kill`, an OOM reaper,
 *  systemd stopping the unit mid-`ws-add`) arrives with `killed === false` and a
 *  `signal` that is the only evidence it was cut short at all. Same optional
 *  discipline: absent = the peer did not tell us; `null` = it did, and there was
 *  no signal. */
export interface ExecResult {
  code: number; stdout: string; stderr: string;
  killed?: boolean;
  signal?: string | null;
}
export type Runner = (cmd: string, args: string[]) => Promise<ExecResult>;

/** §1.7: `local` mode is a PRODUCER of the cut-short measurement too, and it used
 *  to answer neither half — so every `local` ccd call reached `cutShort` as
 *  UNMEASURED, i.e. "nobody looked", when in fact this function holds the very
 *  error object that knows.
 *
 *  BOTH halves are reported, and they say different things here. No deadline is
 *  passed to `execFile` (deliberately — see `localcaps.ts`, which wraps its own
 *  ceiling at the ONE call site that needs one), so node never kills this child
 *  itself and `killed` is a measured, permanently-`false` fact. `signal` is the
 *  half that can be non-null: an operator `kill`, an OOM reaper or systemd
 *  stopping the unit mid-`ws-add` terminates the child by signal, node reports it
 *  in `error.signal`, and `error.killed` stays FALSE because node did not do it.
 *  Dropping `signal` here is what made that case indistinguishable from a clean
 *  `ccd` refusal. */
export const realRunner: Runner = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number; killed?: boolean; signal?: string }) | null;
      const code = err ? (e?.code as number | undefined ?? 1) : 0;
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout: String(stdout), stderr: String(stderr),
        killed: e?.killed === true,
        signal: e?.signal ?? null,
      });
    });
  });

const target = (id: string) => `cc-${id}`;

/** D-309 (was D-B8-13): the server twin of ccd's `_session_verdict` (D-308 (was D-B8-12)). `tmux
 *  has-session` answers three different questions with one exit status —
 *  session gone, server unreachable, client cut short — and only the first is
 *  evidence a session died. `detail` exists ONLY on `unknown`, because there it
 *  is the diagnosis (the tmux message, or what cut the client short) and on the
 *  other two it would be noise pretending to be measurement. */
export type SessionVerdict =
  | { verdict: 'live' }
  | { verdict: 'gone' }
  | { verdict: 'unknown'; detail: string };

/** THE POLARITY IS THE WHOLE DESIGN (D-308, and its bash twin is the
 *  contract: `_session_verdict`, ccd/ccd — the shared fixture
 *  `test/sessionVerdictFixture.ts` keeps the two agreeing). Recognise the ONE
 *  message that means death; call everything else unknown. Never a list of
 *  failures: an unrecognised future tmux error must refuse, not destroy.
 *
 *  `detail` is never '': a blank reason is the one shape a maintainer can do
 *  nothing with, so an empty stderr falls through to whichever measured fact
 *  remains — the signal that cut the client short (the remote agent's execFile
 *  deadline kills a client wedged on an unresponsive server; measured
 *  2026-08-19, a SIGSTOPped server blocks `has-session` indefinitely), the
 *  bare `killed`, or last the exit code itself. */
export function classifyHasSession(r: ExecResult): SessionVerdict {
  if (r.code === 0) return { verdict: 'live' };
  if (r.stderr.includes("can't find session")) return { verdict: 'gone' };
  const msg = r.stderr.trim();
  if (msg !== '') return { verdict: 'unknown', detail: msg };
  if (typeof r.signal === 'string') {
    return { verdict: 'unknown', detail: `tmux client got ${r.signal} before it answered (exit ${r.code})` };
  }
  if (r.killed === true) {
    return { verdict: 'unknown', detail: `tmux client was killed before it answered (exit ${r.code})` };
  }
  return { verdict: 'unknown', detail: `tmux exited ${r.code} with no message` };
}

export class Tmux {
  constructor(private run: Runner) {}
  async sessionVerdict(id: string): Promise<SessionVerdict> {
    return classifyHasSession(await this.run('tmux', ['has-session', '-t', target(id)]));
  }
  /** Derived, exactly like bash `_alive`: true only for `live`. A caller that
   *  handles `gone` differently from `unknown` must use `sessionVerdict`
   *  instead — this boolean is for the sites whose collapse is deliberate and
   *  documented in place (D-309). */
  async hasSession(id: string): Promise<boolean> {
    return (await this.sessionVerdict(id)).verdict === 'live';
  }
  async panePid(id: string): Promise<number | null> {
    const r = await this.run('tmux', ['list-panes', '-t', target(id), '-F', '#{pane_pid}']);
    if (r.code !== 0) return null;
    const pid = parseInt(r.stdout.trim().split('\n')[0] ?? '', 10);
    return Number.isFinite(pid) ? pid : null;
  }
  async capture(id: string): Promise<string | null> {
    const r = await this.run('tmux', ['capture-pane', '-t', target(id), '-p']);
    return r.code === 0 ? r.stdout : null;
  }
  /** Capture WITH escape sequences (`-e`) — needed to tell Claude Code's dim
   *  ghost-suggestion placeholder (`\e[2m…\e[0m`) apart from a real typed draft. */
  async captureAnsi(id: string): Promise<string | null> {
    const r = await this.run('tmux', ['capture-pane', '-t', target(id), '-p', '-e']);
    return r.code === 0 ? r.stdout : null;
  }
  async sendLiteral(id: string, text: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), '-l', text])).code === 0;
  }
  async sendKey(id: string, key: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), key])).code === 0;
  }
  /** Restore the canonical size ccd spawned with. Lived inline at
   *  server.ts:218 as a `void deps.run(...)` — so a `forbidden` there was
   *  swallowed in silence, which is the exact failure the argv enumeration
   *  exists to prevent. */
  async resizeWindow(id: string, cols: number, rows: number): Promise<boolean> {
    return (await this.run('tmux', ['resize-window', '-t', target(id), '-x', String(cols), '-y', String(rows)])).code === 0;
  }
}
