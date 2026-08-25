/**
 * `tmux has-session` answers three different questions with one exit status,
 * and `_alive` collapsed all three into one boolean. Measured 2026-08-19 on an
 * isolated socket, every failure at rc=1:
 *
 *   session gone           can't find session: cc-demo
 *   no server / no socket  error connecting to /tmp/tmux-1000/x (No such file or directory)
 *   socket, but no server  no server running on /tmp/…/deadsock
 *   tmux absent            (rc 127, message from the shell)
 *
 * Only the first is evidence a session died. The other two mean "I could not
 * ask", and the callers that matter want the opposite answer for each:
 *
 *   `_ws_status` returned `idle` when it could not ask — and `idle` is what
 *   `ws-archive` (ccd:3915) and `ws-reap` (ccd:6311) gate on, so an unreachable
 *   tmux server made every live session look reapable. The function already had
 *   a way to say so: its contract is "NON-ZERO when it cannot be read", which
 *   routes to `status-unknown` and refuses. The `_alive` branch was the one path
 *   that answered a question it had not managed to ask.
 *
 *   `ccd forget` proved deadness with `! _alive || die`, so an unreachable
 *   server let it purge the registry row of a RUNNING session — the exact
 *   outcome its own comment warns about ("collapsing the two into one verb
 *   turns a cleanup into a kill"), reached by a route that comment did not
 *   consider. Its neighbouring hold guard is deliberately fail-shut
 *   ("present-but-unreadable refuses"); this one was not.
 *
 * THE POLARITY IS THE WHOLE DESIGN. The verdict recognises the ONE message that
 * means death and calls everything else unknown — it never enumerates the
 * failures. An unrecognised future tmux error therefore degrades to `unknown`,
 * which refuses; enumerating failures would degrade it to `gone`, which
 * destroys. The last test in the first block is that property, and it is the
 * one to keep if the others are ever rewritten.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { VERDICT_MESSAGE_ROWS } from './sessionVerdictFixture.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-verdict-'); });
afterEach(() => { h.cleanup(); });

/** A `tmux` stub whose `has-session` fails with a chosen message on stderr —
 *  the shape the real binary uses for every one of these conditions. */
const tmuxSaying = (msg: string): string =>
  `tmux() { case "$1" in has-session) echo "${msg}" >&2; return 1 ;; esac; return 0; };`;
const TMUX_LIVE = 'tmux() { return 0; };';

const verdict = (stub: string): string =>
  h.sh(`${stub} _session_verdict demo`).trim();

describe('_session_verdict — three answers, not one boolean', () => {
  it('live: has-session succeeded', () => {
    expect(verdict(TMUX_LIVE)).toBe('live');
  });

  // The message rows are SHARED with the TS twin (`classifyHasSession`,
  // exec.test.ts) via the fixture — D-309 (was D-B8-13)'s whole mechanism: two
  // implementations of one contract cannot drift once one table drives both.
  // Nothing here may be rewritten into a list of failures: a tmux upgrade may
  // reword or add errors, and `unknown` refuses where `gone` destroys.
  for (const row of VERDICT_MESSAGE_ROWS) {
    it(row.name, () => {
      expect(verdict(tmuxSaying(row.message))).toBe(row.expected);
    });
  }

  it('unknown: tmux is not on PATH at all', () => {
    expect(h.sh(`command() { if [[ "$1 $2" == "-v tmux" ]]; then return 1; fi; builtin command "$@"; }
                 tmux() { echo "bash: tmux: command not found" >&2; return 127; }
                 _session_verdict demo`).trim()).toBe('unknown');
  });

  it('_alive keeps its old meaning exactly: true only for live', () => {
    const alive = (stub: string): string => h.sh(`${stub} _alive demo && echo yes || echo no`).trim();
    expect(alive(TMUX_LIVE)).toBe('yes');
    expect(alive(tmuxSaying("can't find session: cc-demo"))).toBe('no');
    expect(alive(tmuxSaying('no server running on /tmp/x'))).toBe('no');
  });
});

describe('_ws_status stops answering a question it could not ask', () => {
  const status = (stub: string): { out: string; code: number } => {
    try {
      return { out: h.sh(`${stub} _reg_set demo wrapper claude; _ws_status demo`).trim(), code: 0 };
    } catch (e) {
      const err = e as { status?: number; stdout?: Buffer };
      return { out: String(err.stdout ?? '').trim(), code: err.status ?? 1 };
    }
  };

  it('gone -> idle: there is genuinely no pane, so nothing is running', () => {
    expect(status(tmuxSaying("can't find session: cc-demo"))).toEqual({ out: 'idle', code: 0 });
  });

  it('unknown -> NON-ZERO, which is how this function says "cannot be read"', () => {
    // Non-zero is what `ws-archive` turns into `status-unknown` and `ws-reap`
    // into a refusal. Returning `idle` here is what made an unreachable tmux
    // server present every live session as reapable.
    const r = status(tmuxSaying('no server running on /tmp/tmux-1000/default'));
    expect(r.code).not.toBe(0);
    expect(r.out).not.toBe('idle');
  });
});

describe('ccd forget proves deadness, and cannot be talked out of it by silence', () => {
  const forget = (stub: string): { code: number; stderr: string } => {
    h.sh(`_reg_set demo uuid 72be9ee2-0000-4bcc-b60b-0cfc0dc3d199\n      _reg_set demo project demo\n      _reg_set demo workdir /data/projects/demo\n      _reg_set demo wrapper claude`);
    try {
      h.sh(`${stub} _ws_unsupervise() { :; }; cmd_forget demo`);
      return { code: 0, stderr: '' };
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer };
      return { code: err.status ?? 1, stderr: String(err.stderr ?? '') };
    }
  };

  it('refuses a session it can see running', () => {
    expect(forget(TMUX_LIVE).code).not.toBe(0);
  });

  it('refuses when the tmux server did not answer — deadness must be PROVEN, not assumed', () => {
    const r = forget(tmuxSaying('no server running on /tmp/tmux-1000/default'));
    expect(r.code, 'an unanswered question is not proof of death').not.toBe(0);
    expect(r.stderr).toMatch(/cannot tell|did not answer/i);
  });

  it('proceeds when the session is genuinely gone', () => {
    expect(forget(tmuxSaying("can't find session: cc-demo")).code).toBe(0);
  });
});

describe('_session_probe — the verdict plus its diagnosis, without a subshell (spec §1)', () => {
  it('sets PROBE_VERDICT and a verbatim PROBE_DETAIL for unknown', () => {
    expect(h.sh(`${tmuxSaying('protocol version mismatch (client 8, server 7)')}
      _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim())
      .toBe('unknown|protocol version mismatch (client 8, server 7)');
  });
  it('live and gone carry no detail', () => {
    expect(h.sh(`${TMUX_LIVE} _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim()).toBe('live|');
    expect(h.sh(`${tmuxSaying("can't find session: cc-demo")} _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim()).toBe('gone|');
  });
  it('_session_verdict still answers through the probe — one classifier, not two', () => {
    // Delete/duplicate guard: shadowing _session_probe must change _session_verdict's answer.
    // The tmux stub says LIVE, so a standalone reimplementation of _session_verdict answers
    // `live` on every box — deterministic, and never a probe of the box's real tmux.
    expect(h.sh(`${TMUX_LIVE} _session_probe() { PROBE_VERDICT=gone; PROBE_DETAIL=; }; _session_verdict demo`).trim()).toBe('gone');
  });
  it('a WEDGED tmux is bounded by the deadline and answers unknown with a synthesized, non-empty reason', () => {
    // The wedge shape (spec §1): an EXECUTABLE stub that never answers — timeout(1) can kill a
    // binary, not a bash function, so this test plants a real file on PATH.
    const bin = path.join(h.home, 'wedge-bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'tmux'), '#!/usr/bin/env bash\nsleep 60\n', { mode: 0o755 });
    const out = h.sh(`export PATH="${bin}:$PATH"; SUBSTRATE_PROBE_DEADLINE_S=1
      _session_probe demo; echo "$PROBE_VERDICT|$PROBE_DETAIL"`).trim();
    expect(out).toMatch(/^unknown\|tmux did not answer within 1s$/);
  });
  it('the deadline applies ONLY to a real binary — function stubs keep working undeadlined', () => {
    // The largest test-compat hazard, pinned: `timeout` execs, so every `tmux() { … }` stub in
    // this suite would be invisible if the deadline wrapped them. `_session_probe` must detect
    // the function and call it directly.
    expect(h.sh(`${TMUX_LIVE} _session_probe demo; echo "$PROBE_VERDICT"`).trim()).toBe('live');
  });
});
