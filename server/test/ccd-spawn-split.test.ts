// server/test/ccd-spawn-split.test.ts
//
// THE WAVE'S CENTRAL PINS. F8's shape is a `ws-add` whose blocking wait was
// killed at the agent's 300 s ceiling AFTER the pane existed but BEFORE the
// claim and the supervision were written — a live pane no registry row claimed
// and no unit was watching. The split is what makes those two writes precede
// anything that can block.
//
// FIXTURE HOMES ONLY. ws-rm / ws-reap / ws-gc --prune / ws-archive / ws-restore
// are human-only by contract and appear in no step here.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, WS_ADD_REAL_SPAWN, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-split-'); });
afterEach(() => { h.cleanup(); });

/** `h.sh`, minus the two things that make it unable to see a fatal `die`:
 *  it throws on non-zero, and it gives back no status.
 *
 *  THE STATUS OF THE OUTERMOST BASH IS THE MEASUREMENT. `die` is
 *  `echo …; exit 1`, and `exit` inside a command substitution or an explicit
 *  `( … )` kills only that subshell — so ANY wrapping (`$( )`, `( )`, a
 *  trailing `; :`) turns the thing under test into its own negation and the
 *  assertion passes either way. Nothing here may wrap. `exec 2>&1` merges the
 *  streams for the same reason: it rebinds the CURRENT shell's fd and starts
 *  no subshell. Otherwise identical to `h.sh` — same `cwd: home`, same
 *  `ghContainedEnv`. */
const shStatus = (snippet: string, env: NodeJS.ProcessEnv = {}): { status: number; out: string } => {
  try {
    const out = execFileSync('bash', ['-c', `source "${CCD}"; exec 2>&1; ${snippet}`],
      { encoding: 'utf8', cwd: h.home, env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, ...env }) });
    return { status: 0, out };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

/** The tmux substrate modelled by ONE file, $HOME/pane-up — the
 *  ccd-spawn-verdict.test.ts idiom. `sleep` is a no-op so the gate loop costs
 *  no wall time; `date` is NOT stubbed here (Task 5 needs that and settles it
 *  there). */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-? for shortcuts}" ;;
    esac
  };`;

const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
};

describe('_spawn_start / _spawn_settle', () => {
  it('_spawn_start creates the pane and sets SPAWN_FROMSWAP, writing NOTHING to started', () => {
    seed('myid');
    const out = h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new; echo "[$SPAWN_FROMSWAP]"`);
    // The whole of stdout, and the ONLY thing on it is the echo this snippet
    // added: `_spawn_start` answers through the global and prints nothing, so
    // no caller has to filter its output out of what it was printing itself.
    expect(out).toBe('[0]');
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
    // THE INVARIANT: the start half is not the claiming half. The caller is.
    expect(h.reg('myid', 'started')).toBeNull();
  });

  it('_spawn_start sets SPAWN_FROMSWAP=1 when the spawn lands within 300s of a swap', () => {
    seed('myid');
    const out = h.sh(
      `${TMUX} date() { if [[ "\${1:-}" == "+%s" ]]; then echo 1000; else command date "$@"; fi; }
       printf '%s' 990 > "$REG/myid.lastswap"
       _spawn_start myid resume; echo "[$SPAWN_FROMSWAP]"`);
    expect(out).toBe('[1]');
  });

  it('SPAWN_FROMSWAP exists before any spawn runs — `set -u` cannot kill a reader', () => {
    // The global is initialised at file scope. Without that, a caller reading
    // it after a stubbed or early-returning `_spawn_start` would not get a
    // wrong answer, it would get an "unbound variable" that exits the shell.
    expect(h.sh('echo "[$SPAWN_FROMSWAP]"')).toBe('[0]');
  });

  it('_spawn_start returns without blocking — it never polls the pane', () => {
    seed('myid');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid new`);
    expect(h.calls().some((c) => c.includes('capture-pane'))).toBe(false);
  });

  it('_spawn_settle is the blocking half — it polls, stamps `spawn`, and returns the rc', () => {
    seed('myid');
    // `: > pane-up` IS the precondition, not fixture noise: _spawn_settle's
    // contract is that _spawn_start already made the pane, and the gate loop's
    // FIRST probe each tick is `has-session`. Against a fresh fixture HOME with
    // no pane the honest answer is rc 3 ("the tmux session vanished during
    // startup"), which is the tree behaving correctly — so the live pane has to
    // be modelled here for this to be a test of the settle half at all.
    h.sh(`${TMUX} : > "$HOME/pane-up"; _spawn_settle myid 0`, { PANE_TEXT: '? for shortcuts' });
    expect(h.calls().some((c) => c.includes('capture-pane'))).toBe(true);
    expect(h.reg('myid', 'spawn')).toMatch(/^\d+ 0$/);
    expect(h.reg('myid', 'started')).toBeNull();
  });

  it('_spawn is still the composition — one call, same behaviour as before the split', () => {
    seed('myid');
    h.sh(`${TMUX} _spawn myid new; :`, { PANE_TEXT: '? for shortcuts' });
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
    expect(h.reg('myid', 'spawn')).toMatch(/^\d+ 0$/);
  });

  it('_spawn calls both halves and threads NO bound positional', () => {
    const body = h.sh('type _spawn');
    expect(body).toContain('_spawn_settle');
    expect(body).toContain('_spawn_start');
    // The name has now been wrong twice, in opposite directions, so it says
    // only what this body measures. It was "threads the settle bound through as
    // its third positional" while the body greped for two function names and
    // `_spawn` passed no `$3` at all; Task 5 threaded a `$3` for real; and that
    // `$3` came from a second positional on `cmd_ensure`, a whitelisted verb —
    // an argv word that lands in `(( ))` is arbitrary code (see the
    // "not addressable from argv" block below). The bound is `CCD_SETTLE_BOUND`
    // now, so there is no positional left to thread and none may come back.
    expect(body).not.toContain('${3:-$SPAWN_SETTLE_S}');
    expect(body).toContain('_spawn_settle "$1" "$SPAWN_FROMSWAP"');
  });

  it('_spawn_start still dies on an incomplete registry — the guard did not move, and it is still FATAL', () => {
    // Replaces a version of this test that ran `(_spawn_start nosuchid new) 2>&1`
    // and greped stdout. That shape was structurally incapable of failing: the
    // explicit `( )` swallowed the `exit`, so it read the same whether the
    // guard was fatal or had degraded to `return 1`. The message text is still
    // pinned — it is what an operator greps for — but the STATUS is the point.
    const r = shStatus(`${TMUX} _spawn_start nosuchid new; echo SURVIVED`);
    expect(r.status).toBe(1);
    expect(r.out).toContain("incomplete registry for 'nosuchid'");
    expect(r.out).not.toContain('SURVIVED');
  });

  it('_spawn is fatal on an incomplete registry too — the composition does not demote die to rc 1', () => {
    // THE REGRESSION THIS PINS, measured on this branch: with `_spawn_start`
    // read through `fs=$(_spawn_start …)`, `die`'s `exit 1` killed only the
    // command-substitution subshell and the composition returned 1. rc 1 is in
    // NO caller's failure set — `cmd_ws_add`, `cmd_start` and `cmd_ensure` all
    // test `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]` — so each printed its SUCCESS
    // line and exited 0 over a spawn that never happened. Status 0 here IS that
    // bug; at d7137c2 (before the split) this shell exited 1 and never printed
    // SURVIVED.
    const r = shStatus(`${TMUX} _spawn nosuchid new; echo SURVIVED`);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("incomplete registry for 'nosuchid'");
    expect(r.out).not.toContain('SURVIVED');
  });

  // EVERY caller of `_spawn_start`, not just the composition. The structural
  // half of the pin above was written against `_spawn` alone, which left the
  // regression free to come back through any call site added after it — and
  // Tasks 7/8 add five. A NEW CALLER MUST BE ADDED TO THIS LIST in the same
  // commit that adds the call: the list is what makes the rule mechanical
  // rather than a comment somebody has to read.
  const SPAWN_START_CALLERS = [
    '_spawn', 'cmd_ws_add', 'cmd_ws_restore', '_supervised_start', 'cmd_start', 'cmd_ensure',
  ];

  it.each(SPAWN_START_CALLERS)(
    '%s reads fromswap out of the GLOBAL — no command substitution around _spawn_start',
    (fn) => {
      // `$(_spawn_start …)` is what turned `die`'s `exit 1` into rc 1, a code in
      // no caller's failure set, so every caller printed success over a spawn
      // that never happened. With no `$( )` anywhere, `die` is process-fatal by
      // construction instead of by test.
      const body = h.sh(`type ${fn}`);
      expect(body).not.toMatch(/\$\(\s*_spawn_start/);
      expect(body).toContain('SPAWN_FROMSWAP');
    });

  it('the caller list is complete — nothing calls _spawn_start off the list', () => {
    // The list above only means something if it is exhaustive. Ask the SHELL
    // which functions mention `_spawn_start`, rather than trusting the list to
    // have been updated: a new caller that forgets to enrol turns up here.
    const callers = h.sh(
      'while read -r f; do [[ "$f" == _spawn_start ]] && continue;'
      + ' type "$f" 2>/dev/null | grep -q "_spawn_start" && echo "$f"; done'
      + ' < <(declare -F | sed "s/^declare -f //") | sort; :');
    expect(callers.split('\n').filter(Boolean).sort())
      .toEqual([...SPAWN_START_CALLERS].sort());
  });
});

// ---------------------------------------------------------------------------
// §1.1 — THE ORDERING IS THE FIX (F8).
// ---------------------------------------------------------------------------

describe('ws-add writes the claim and the supervision BEFORE anything blocks', () => {
  it('claims and supervises before the settle — asserted by ORDER, not assumed', () => {
    h.makeRepo('demo');
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo; :`);
    const calls = h.calls();
    const news    = calls.findIndex((c) => c.startsWith('tmux new-session'));
    const superv  = calls.findIndex((c) => c === 'supervise demo-quiet-mesa');
    const accept  = calls.findIndex((c) => c.startsWith('accept '));
    expect(news).toBeGreaterThanOrEqual(0);
    expect(superv).toBeGreaterThan(news);
    expect(accept).toBeGreaterThan(superv);
    expect(h.reg('demo-quiet-mesa', 'started')).toBe('1');
  });

  // H6 / F8, directly: the workspace a KILLED ws-add leaves behind is an
  // ordinary restartable session, not a live pane no row claims and no unit
  // watches. This is also what makes the deploy's supervisor sweep safe at any
  // moment.
  it('a settle that never returns still leaves a CLAIMED, SUPERVISED workspace', () => {
    h.makeRepo('demo');
    // The settle is the only half that can be killed; model it as a refusal
    // that arrives after the claim, and prove both writes already landed.
    h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo; :`, { ACCEPT_RC: '4' });
    expect(h.reg('demo-quiet-mesa', 'started')).toBe('1');
    expect(h.calls()).toContain('supervise demo-quiet-mesa');
    expect(h.reg('demo-quiet-mesa', 'uuid')).not.toBeNull();
  });

  it('still returns the rc and withholds the success line on rc 4', () => {
    h.makeRepo('demo');
    let code = 0;
    try { h.sh(`${WS_ADD_REAL_SPAWN} CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`, { ACCEPT_RC: '4' }); }
    catch (e) { code = (e as { status?: number }).status ?? 1; }
    expect(code).toBe(4);
  });

  it('ws-restore takes the same shape, and gives the reap lock back before the settle', () => {
    // The settle can block for SPAWN_SETTLE_S; holding a reap lock across it
    // would refuse every ws-reap on this id for four minutes.
    //
    // NOT `indexOf('exec {lfd}>&-')` — that finds the FIRST occurrence, and
    // `cmd_ws_restore` already closes the fd inside its flock-REFUSAL block
    // (`flock -n "$lfd" || { exec {lfd}>&-; die "another ccd process is
    // reaping $id …" }`), which precedes everything. The mutant this test
    // exists to kill would survive it. `lastIndexOf` is the RELEASE site, and
    // the count is pinned at 2 so neither a third close nor a deleted release
    // can slip past: delete the release and the count is 1; move it after the
    // settle and the last index overtakes it.
    //
    // `type` and not the file, and therefore NOT a comment anchor: bash
    // deparses a function from its parse tree and comments do not survive it
    // (measured — the plan's `indexOf('GIVEN BACK BEFORE THE SETTLE')` can
    // never be > -1). Ordering is asserted on the CODE.
    const t = h.sh('type cmd_ws_restore');
    expect(t.split('exec {lfd}>&-').length - 1).toBe(2);
    expect(t.lastIndexOf('exec {lfd}>&-')).toBeLessThan(t.indexOf('_spawn_settle'));
    expect(t.indexOf('_reg_claim')).toBeLessThan(t.indexOf('_spawn_settle'));
    expect(t.indexOf('_ws_supervise')).toBeLessThan(t.indexOf('_spawn_settle'));
  });
});

/** A FAKE CLOCK the gate loop's own `sleep` drives. Without this the bound is
 *  untestable: every existing spawn fixture stubs `sleep` to a no-op, so 450
 *  iterations run in milliseconds and no wall-clock bound could ever fire —
 *  neither `date +%s` nor `SECONDS`. `_faketime` is a TOP-LEVEL variable and
 *  `date` echoes it by name deliberately: unlike `_session_state`'s `now`,
 *  nothing declares `local _faketime`, so no callee can shadow it. */
const FAKE_CLOCK = `_faketime=0
  sleep() { _faketime=$((_faketime + \${1:-1})); }
  date() { if [[ "\${1:-}" == "+%s" ]]; then echo "$_faketime"; else command date "$@"; fi; }`;

describe('the settle bound is wall-clock, and it is per caller', () => {
  it('SPAWN_SETTLE_S is 240 and SPAWN_SETTLE_SUPERVISE_S is 1350', () => {
    expect(h.sh('echo "$SPAWN_SETTLE_S $SPAWN_SETTLE_SUPERVISE_S"')).toBe('240 1350');
  });

  it('neither is an env override — HOME is ccd\'s only isolation boundary', () => {
    expect(h.sh('echo "$SPAWN_SETTLE_S"', { SPAWN_SETTLE_S: '7' })).toBe('240');
    expect(h.sh('echo "$SPAWN_SETTLE_SUPERVISE_S"', { SPAWN_SETTLE_SUPERVISE_S: '7' })).toBe('1350');
  });

  it('_accept_first_run_prompts returns 4 once the WALL CLOCK passes the bound', () => {
    const out = h.sh(
      `${FAKE_CLOCK}
       tmux() { case "$1" in has-session) return 0 ;; capture-pane) printf '' ;; esac; }
       CCD_SETTLE_BOUND=10 _accept_first_run_prompts cc-test 0; echo "rc=$? t=$_faketime"`);
    expect(out).toMatch(/rc=4/);
    // ~5 iterations of `sleep 2`, not 450: the bound fired, not the counter.
    expect(Number(/t=(\d+)/.exec(out)![1])).toBeLessThan(20);
  });

  it('keeps the iteration cap as the second bound — the supervise bound never reaches it', () => {
    // 450 polls x 2s = 900s < SPAWN_SETTLE_SUPERVISE_S, so cmd_supervise's
    // window is exactly today's. Only the agent-reachable path is shortened.
    expect(h.sh('echo $((SPAWN_GATE_TRIES * 2 < SPAWN_SETTLE_SUPERVISE_S))')).toBe('1');
  });

  it('the bound is NOT keyed off fromswap — a swap is the FAST branch, ws-add is not', () => {
    // The discriminator runs backwards from the obvious reading: cmd_swap
    // writes lastswap two lines before the restart, so fromswap=1 IS the swap.
    // Keyed off fromswap, a fresh ws-add would get the long window.
    //
    // MEASURED, not grepped. The plan proposed
    // `expect(type _accept_first_run_prompts).not.toMatch(/fromswap.*bound=/)`,
    // which bash's own deparse makes unsatisfiable: `local … fromswap="${2:-0}"
    // bound="${3:-$SPAWN_SETTLE_S}" …` renders on ONE line, so the regex fires
    // on the correct implementation. What the claim actually is — the DEFAULT
    // window is the same for both discriminator values — is a behavioural fact,
    // so measure it. SPAWN_SETTLE_S is reassigned after sourcing, which is the
    // documented way to shrink a production constant under test.
    const expiredAt = (fromswap: string): string => h.sh(
      `SPAWN_SETTLE_S=10
       ${FAKE_CLOCK}
       tmux() { case "$1" in has-session) return 0 ;; capture-pane) printf '' ;; esac; }
       _accept_first_run_prompts cc-test ${fromswap}; echo "rc=$? t=$_faketime"`);
    expect(expiredAt('1')).toBe('rc=4 t=10');
    expect(expiredAt('0')).toBe(expiredAt('1'));
  });

  it('_spawn_settle takes NO bound positional — it threads none, and reads none', () => {
    // The single reader is `_accept_first_run_prompts`; the settle half neither
    // takes a `$3` nor passes one. Two readers of one dynamically-scoped
    // variable would be two places to remember the validation.
    const body = h.sh('type _spawn_settle');
    expect(body).not.toContain('${3:-$SPAWN_SETTLE_S}');
    expect(body).toContain('_accept_first_run_prompts "$tname" "$fromswap"');
  });

  it('_accept_first_run_prompts is the ONE reader of CCD_SETTLE_BOUND, and it defaults to SPAWN_SETTLE_S', () => {
    expect(h.sh('type _accept_first_run_prompts')).toContain('${CCD_SETTLE_BOUND:-$SPAWN_SETTLE_S}');
    // Nobody else reads it: one reader is what makes one validation enough.
    const readers = h.sh(
      'for f in _spawn _spawn_start _spawn_settle _accept_first_run_prompts cmd_ensure cmd_start;'
      + ' do type "$f" | grep -q "CCD_SETTLE_BOUND:-" && echo "$f"; done; :');
    expect(readers).toBe('_accept_first_run_prompts');
  });
});

/** THE BOUND IS NOT AN ARGV SURFACE.
 *
 *  `(( ))` evaluates its operand's CONTENTS as an arithmetic expression, and a
 *  command substitution inside an ARRAY SUBSCRIPT executes before the
 *  arithmetic even errors:
 *
 *      $ REG=/tmp; bound='REG[$(touch /tmp/PWNED)]'; (( 0 >= bound ))
 *      bash: ((: /tmp: syntax error: operand expected     # …and PWNED exists.
 *
 *  So a `bound` that reaches `_accept_first_run_prompts`'s
 *  `(( $(date +%s) - t0 >= bound ))` from ARGV is arbitrary code execution as
 *  the fleet user. The agent grants `['ensure']` and its own docstring says
 *  "tokens after the prefix are unconstrained" — a second positional on
 *  `cmd_ensure` is therefore reachable across the exec boundary the moment any
 *  call site emits one. It is closed structurally: the bound travels as
 *  `CCD_SETTLE_BOUND`, a dynamically-scoped `local` (the CCD_IN_UNIT idiom),
 *  never an argv token.
 *
 *  FIXTURE HOME ONLY — the payload writes `$HOME/PWNED` inside the harness's
 *  own tmpdir and nowhere else. */
describe('the settle bound is not addressable from argv', () => {
  /** The payload: substituted, it runs `touch`; evaluated, it is a path and a
   *  syntax error. Single-quoted so the SNIPPET's shell leaves it alone and only
   *  an arithmetic context can expand it. */
  const PAYLOAD = `'REG[$(touch "$HOME/PWNED")]'`;
  const pwned = (): boolean => fs.existsSync(path.join(h.home, 'PWNED'));

  it('cmd_ensure does not evaluate a second positional — no command substitution runs', () => {
    seed('myid');
    // CCD_IN_UNIT=1 selects the DIRECT spawn path (the supervised branch would
    // hand off to a unit and never reach the gate loop in this process), and
    // SPAWN_GATE_TRIES=2 keeps the loop short. PANE_TEXT matches no branch, so
    // every iteration reaches the `(( ))` — which is the point.
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; SPAWN_GATE_TRIES=2; CCD_IN_UNIT=1;`
       + ` cmd_ensure myid ${PAYLOAD}; :`,
      { PANE_TEXT: 'a pane with nothing this function recognises' });
    expect(pwned()).toBe(false);
  });

  it('cmd_ensure consumes NO second positional at all', () => {
    // The structural half: a validated `$2` would still be an argv surface, and
    // the next editor would have only a comment stopping them widening it.
    const body = h.sh('type cmd_ensure');
    expect(body).not.toContain('${2:-$SPAWN_SETTLE_S}');
    expect(body).not.toMatch(/\$\{?2[:}]/);
  });

  it('a hostile CCD_SETTLE_BOUND is rejected before the arithmetic, not executed by it', () => {
    // Defense in depth. Nothing on the wire sets a shell variable — the agent
    // whitelists ARGV — so this is not a reachable path today; it is the guard
    // that keeps `(( ))` safe for whoever edits this function next.
    const out = h.sh(
      `${FAKE_CLOCK}
       tmux() { case "$1" in has-session) return 0 ;; capture-pane) printf '' ;; esac; }
       CCD_SETTLE_BOUND=${PAYLOAD}
       _accept_first_run_prompts cc-test 0; echo "rc=$? t=$_faketime"`);
    expect(pwned()).toBe(false);
    // …and it degrades to the PRODUCTION DEFAULT, not to "no bound" and not to
    // zero: t=240 is SPAWN_SETTLE_S, measured on the fake clock.
    expect(out).toBe('rc=4 t=240');
  });

  it('cmd_supervise still RAISES the bound — through the variable, not an argv word', () => {
    expect(h.sh('type cmd_supervise')).toContain('local CCD_SETTLE_BOUND=$SPAWN_SETTLE_SUPERVISE_S');
    expect(h.sh('type cmd_supervise')).toContain('cmd_ensure "$id"');
    expect(h.sh('type cmd_supervise')).not.toContain('cmd_ensure "$id" "$SPAWN_SETTLE_SUPERVISE_S"');
  });

  it('the raised bound actually reaches the gate loop — dynamic scoping, measured', () => {
    // `local` is dynamically scoped, so the variable cmd_supervise sets is
    // visible to `_accept_first_run_prompts` several frames down without any
    // function in between naming it. Measured through a stand-in for
    // cmd_supervise's frame, because the real one blocks on a watch loop.
    const out = h.sh(
      `${FAKE_CLOCK}
       tmux() { case "$1" in has-session) return 0 ;; capture-pane) printf '' ;; esac; }
       outer() { local CCD_SETTLE_BOUND=30; _accept_first_run_prompts cc-test 0; }
       outer; echo "rc=$? t=$_faketime"`);
    // 30, not SPAWN_SETTLE_S's 240: the caller's frame won.
    expect(out).toBe('rc=4 t=30');
  });
});

/** THE PRICE OF A MONOTONE `started`. Nothing in ccd ever clears the field —
 *  no `_reg_del`, no `_reg_unset`, and `_reg_purge` destroys the identity
 *  rather than un-claiming it — so once a row is claimed every later revival
 *  picks `mode=resume`. If the session never really came up, `--resume '<uuid>'`
 *  names a uuid with no transcript behind it and the wrapper exits immediately,
 *  forever, on every retry AND every `Restart=always` cycle. `_spawn_settle`'s
 *  own rc 3/4 warnings already name the trap and tell a human to clear the
 *  field; this is that escape hatch, taken once, automatically. */
describe('_spawn_start: the --resume fallback a monotone `started` owes', () => {
  /** A tmux whose `--resume` new-session leaves no pane (the wrapper exits on a
   *  uuid with no transcript) but whose `--session-id` one does. */
  const RESUME_DIES = `sleep() { :; };
    tmux() {
      echo "tmux $*" >> "$HOME/ccd-calls"
      case "$1" in
        new-session)  case "$*" in *--session-id*) : > "$HOME/pane-up" ;; esac ;;
        has-session)  [[ -e "$HOME/pane-up" ]] ;;
        list-sessions) return 0 ;;
      esac
    };`;

  const newSessions = (): string[] => h.calls().filter((c) => c.startsWith('tmux new-session'));

  it('retries ONCE with --session-id when the resume produced no session', () => {
    seed('myid');
    h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null`);
    const news = newSessions();
    expect(news).toHaveLength(2);
    expect(news[0]).toContain('--resume');
    expect(news[1]).toContain('--session-id');
  });

  it('says so on stderr — a silent second spawn is a fact nobody can audit', () => {
    seed('myid');
    const r = shStatus(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    expect(r.status).toBe(0);
    expect(r.out).toContain("--resume 'deadbeef-0000-4000-8000-000000000000' left no session");
  });

  it('does NOT retry when the resume worked', () => {
    seed('myid');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn_start myid resume`);
    expect(newSessions()).toHaveLength(1);
  });

  it('does NOT retry a `new` spawn — there is nothing to fall back to', () => {
    seed('myid');
    h.sh(`sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 1 ;; esac; };
          _spawn_start myid new`);
    expect(newSessions()).toHaveLength(1);
  });

  it('retries at most once — never a loop', () => {
    // A tmux where NOTHING ever produces a pane. One retry, then the settle's
    // rc 3 is the honest verdict; a loop here would spend the whole window
    // minting panes nobody watches.
    seed('myid');
    h.sh(`sleep() { :; }; tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 1 ;; esac; };
          _spawn_start myid resume 2>/dev/null`);
    expect(newSessions()).toHaveLength(2);
  });

  it('still writes nothing to `started`, and still answers in the GLOBAL', () => {
    // The retry does not make the start half into the claiming half.
    seed('myid');
    const out = h.sh(`${RESUME_DIES} rm -f "$HOME/pane-up"; _spawn_start myid resume 2>/dev/null; echo "[$SPAWN_FROMSWAP]"`);
    expect(out).toBe('[0]');
    expect(h.reg('myid', 'started')).toBeNull();
  });
});
