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

  it('_spawn threads the settle bound through as its third positional', () => {
    expect(h.sh('type _spawn')).toContain('_spawn_settle');
    expect(h.sh('type _spawn')).toContain('_spawn_start');
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
