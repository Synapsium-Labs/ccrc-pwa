import { execFile } from 'node:child_process';
import type { PaneProbe } from '../../shared/api.js';

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

/** `captureHistory`'s answer. `detail` exists ONLY on `unmeasured`, for
 *  `SessionVerdict`'s reason: there it is the diagnosis, and on the other two
 *  it would be noise pretending to be measurement. */
export type CaptureHistory =
  | { ok: true; text: string }
  | { ok: false; reason: 'gone' }
  | { ok: false; reason: 'unmeasured'; detail: string };

/** The six per-pane formats one `list-panes` answers with, in the order the
 *  parser below reads them (F8 — all six are per-pane formats under a verb the
 *  agent already grants, so this opens no new door). Exported because the test
 *  pins the string itself: a reordering would silently swap two of the numbers
 *  for each other and every guard downstream would go on believing them. */
export const PANE_PROBE_FORMAT =
  '#{pane_active} #{history_size} #{history_limit} #{pane_width} #{pane_height} #{alternate_on}';

/** One row of `PANE_PROBE_FORMAT`: active flag, four counts, alt flag. */
const PANE_PROBE_ROW = /^([01]) (\d+) (\d+) (\d+) (\d+) ([01])$/;

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
  /**
   * ONE MEASUREMENT OF THE PANE the drawer is about to read, and the four
   * answers it can honestly give (spec §5.2).
   *
   * THE ACTIVE ROW, NOT THE FIRST (F7). `list-panes -t <session>` lists every
   * pane of the current window, while `capture-pane -t <session>` reads the
   * ACTIVE one — so a probe that took row `[0]` would describe a pane the
   * capture never read. Measured on a private tmux 3.4 socket against a split
   * window: pane 0 answered `0 278 2000 220 25 0` and pane 1
   * `1 5 2000 220 24 1`, and the capture returned pane 1. This is the exact
   * defect PR #96 shipped.
   *
   * THE `gone` LITERAL IS `list-panes`' OWN, and it is NOT `capture-pane`'s.
   * Measured, tmux 3.4: `list-panes -t cc-nope` answers `can't find window:
   * cc-nope` where `capture-pane` answers `can't find pane: cc-nope`. Matching
   * on the wrong one would make a dead session read as `unreadable` forever.
   * The polarity is `classifyHasSession`'s (D-308/D-309): recognise the ONE
   * message that means gone and call everything else unknown, so an
   * unrecognised future tmux error reads as "we could not look" rather than as
   * death.
   *
   * AND `unparseable` IS ITS OWN ARM, not a flavour of `unreadable`. tmux
   * answering rc 0 with no active row is a different fact from tmux refusing:
   * the server is up and reachable, and what failed is this adapter's reading
   * of it. A caller shows a different sentence for each, so folding them would
   * be an adapter narrowing a distinction it received.
   */
  async paneProbe(id: string): Promise<PaneProbe> {
    const r = await this.run('tmux', ['list-panes', '-t', target(id), '-F', PANE_PROBE_FORMAT]);
    if (r.code !== 0) {
      if (r.stderr.includes("can't find window")) return { ok: false, reason: 'gone' };
      const msg = r.stderr.trim();
      return {
        ok: false,
        reason: 'unreadable',
        detail: msg !== '' ? msg : `tmux exited ${r.code} with no message`,
      };
    }
    const rows = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '');
    const active = rows.find((l) => l.startsWith('1 '));
    if (active === undefined) {
      return {
        ok: false,
        reason: 'unparseable',
        detail: `list-panes returned ${rows.length} row(s), none active`,
      };
    }
    const m = PANE_PROBE_ROW.exec(active);
    if (m === null) {
      return {
        ok: false,
        reason: 'unparseable',
        detail: `active row did not match the six-field shape: ${active}`,
      };
    }
    return {
      ok: true,
      history: Number(m[2]),
      limit: Number(m[3]),
      width: Number(m[4]),
      height: Number(m[5]),
      alternate: m[6] === '1',
    };
  }
  /**
   * The drawer's scrollback read: the pane's stored history AND its live
   * screen, with escape sequences kept so the history reads in the colours it
   * was written in. `-S -<lines>` starts that many lines above the screen;
   * tmux returns what it HAS, so asking for more than `history-limit` is not
   * an error (measured on the live box: `-S -2000` against a 1953-line history
   * answers 2003 lines, 161 KB plain / 201 KB with `-e`, in 43 ms).
   *
   * THREE CONDITIONS, NOT TWO, and that is why this does not return
   * `string | null` like its two siblings above. A caller has to tell "the
   * session is gone" (render nothing, the drawer is already showing the loss
   * overlay) from "we could not look" (say so, offer the read again) — collapse
   * them and the drawer reports a dead session for a tmux server that was busy.
   * The polarity is `classifyHasSession`'s (D-308/D-309): recognise the ONE
   * message that means gone, call everything else unknown, so an unrecognised
   * future tmux error reads as "unmeasured" rather than as death. The message
   * is `capture-pane`'s own and differs from `has-session`'s — measured
   * against tmux 3.4: `can't find pane: cc-nope`.
   */
  async captureHistory(id: string, lines: number): Promise<CaptureHistory> {
    // `-J` JOINS WHAT TMUX ALREADY WRAPPED, and it is here because the reader
    // is not the pane. A stored line was hard-wrapped at the PANE's width, so a
    // phone rendering that capture wraps the remainder a second time — a word
    // broken mid-way and the continuation indented under nothing. `-J` hands
    // back the LOGICAL line and lets the reader wrap it at their own width,
    // once.
    //
    // AND THE LOGICAL LINE IS THE ONE THING A RESIZE CANNOT COST (F1, spec
    // §2). An earlier version of this comment claimed the opposite — that a
    // stored line survives a resize untouched; that is FALSE and was measured
    // false on a private tmux 3.4 socket —
    // `resize-window -x 43` on a 220-column pane holding 1853 stored lines took
    // `history_size` to 9460, and at `history-limit 2000` the next output shed
    // ~600 lines that never came back. What survives a reflow is the logical
    // line, which is exactly what `-J` returns, which is why the flag belongs
    // here and why the window is PINNED at the canonical grid before any client
    // attaches (`GET /ws/pty/:id`, spec §5.1) rather than trusted not to move.
    // The refutation deliberately does NOT restate the claim it refutes:
    // `pane-history-route.test.ts` scans this file for that sentence, and a
    // comment quoting it in order to deny it is indistinguishable, to a scan,
    // from one asserting it.
    //
    // MEASURED on a private socket against a real 200-column transcript:
    // 1882 captured lines become 1113 (-41%) for +0.05% of bytes and no
    // measurable time; a 43-column phone renders 5861 rows instead of 6130,
    // which also puts the read back inside the `lines * 3` scrollback the
    // drawer sizes for it and over which today's capture silently spills.
    // The saving is the ragged remainder, so it is zero when the reader's
    // width happens to divide the pane's (200 into 40) and real everywhere
    // else.
    //
    // NO TRIM RIDES WITH IT. `-J` also keeps trailing spaces that were
    // PAINTED, and trimming them measured zero rows saved at every width while
    // cutting a full-width reverse-video bar from 196 rendered cells to 6 —
    // tmux strips only the trailing spaces that carry default attributes, so
    // what is left is content, not padding. It would also be this adapter
    // narrowing a distinction tmux handed it.
    const r = await this.run('tmux',
      ['capture-pane', '-t', target(id), '-p', '-e', '-J', '-S', `-${lines}`]);
    if (r.code === 0) return { ok: true, text: r.stdout };
    if (r.stderr.includes("can't find pane")) return { ok: false, reason: 'gone' };
    const msg = r.stderr.trim();
    return {
      ok: false,
      reason: 'unmeasured',
      detail: msg !== '' ? msg : `tmux exited ${r.code} with no message`,
    };
  }
  async sendLiteral(id: string, text: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), '-l', text])).code === 0;
  }
  async sendKey(id: string, key: string): Promise<boolean> {
    return (await this.run('tmux', ['send-keys', '-t', target(id), key])).code === 0;
  }
  /** Restore the canonical size ccd spawned with. Lived inline at
   *  server.ts:227 as a `void deps.run(...)` — so a `forbidden` there was
   *  swallowed in silence, which is the exact failure the argv enumeration
   *  exists to prevent. */
  async resizeWindow(id: string, cols: number, rows: number): Promise<boolean> {
    return (await this.run('tmux', ['resize-window', '-t', target(id), '-x', String(cols), '-y', String(rows)])).code === 0;
  }
}
