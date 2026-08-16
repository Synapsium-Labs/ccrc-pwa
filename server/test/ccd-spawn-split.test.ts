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
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

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

  it('_spawn reads fromswap out of the GLOBAL — no command substitution around _spawn_start', () => {
    // The structural half of the pin above, so the composition cannot be
    // "cleaned up" back into `fs=$(_spawn_start …)` while the behavioural test
    // is passing for some other reason. Tasks 7/8 add more call sites; every
    // one of them must have this shape.
    const body = h.sh('type _spawn');
    expect(body).not.toMatch(/\$\(\s*_spawn_start/);
    expect(body).toContain('SPAWN_FROMSWAP');
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
