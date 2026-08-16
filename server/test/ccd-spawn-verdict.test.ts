// §3.3: a spawn reports what actually happened. M6 is the defect this file
// exists for — with the tmux session gone, `tmux capture-pane` fails, `$pane`
// is empty, no branch of `_accept_first_run_prompts` matches, and ~15 minutes
// later the `for` loop falls out returning its last `sleep 2`'s status: 0.
// `_spawn` propagated that and `cmd_ensure` printed `ensured` over a session
// that never came up.
//
// Harness: the ccd-login-screen.test.ts idiom — source ccd under an isolated
// HOME and shadow `tmux` with a shell function, so every argv lands in
// $HOME/ccd-calls and `capture-pane` answers from $PANE_TEXT. Nothing here
// reaches a real tmux server, a real unit, or the live HOME.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeCcdHarness, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-spawn-'); });
afterEach(() => { h.cleanup(); });

/** The tmux substrate modelled by ONE file, $HOME/pane-up: `new-session`
 *  creates it, `kill-session` removes it, `has-session` answers from it. That
 *  is what makes "the session vanished mid-poll" expressible at all — the
 *  older stub answered has-session with a logged 0 forever, so no test could
 *  see M6. `SPAWN_MAKES_PANE=0` is the 21:32:17 shape: new-session returns,
 *  no pane is ever there. */
const TMUX = `sleep() { :; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  [[ "\${SPAWN_MAKES_PANE:-1}" == 1 ]] && : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' "\${PANE_TEXT:-}" ;;
    esac
  };`;

const shFail = (snippet: string, env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** The registry `_spawn` demands (`incomplete registry` dies otherwise). */
const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
};

const rcOf = (snippet: string, env: NodeJS.ProcessEnv = {}): number =>
  Number(/rc=(\d+)/.exec(h.sh(`${TMUX} rm -f "$HOME/pane-up"; ${snippet}; echo "rc=$?"`, env))![1]);

describe('_accept_first_run_prompts: four verdicts, no silent success', () => {
  it('returns 3 once a SECOND probe confirms the tmux session is gone — a fast debounce, not a 15-minute wait (M6)', () => {
    // Kills three mutants at once: dropping the has-session probe entirely (the
    // pre-fix code, which polls a dead session for the full window and then
    // answers 0), probing AFTER the capture (which would burn a capture on
    // nothing), and trusting a SINGLE has-session read (review finding: one
    // flaky read on a loaded box would tip a healthy long resume into a false
    // rc 3, and this task made rc 3 loud). `sleep` is stubbed to a no-op, so
    // the debounce costs nothing in wall time here but is still two real calls.
    expect(rcOf('_accept_first_run_prompts cc-test 0')).toBe(3);
    expect(h.calls().filter((c) => c.includes('capture-pane'))).toEqual([]);
    expect(h.calls().filter((c) => c.includes('has-session')).length).toBe(2);
  });

  it('returns 4 when the window expires with no live marker, and polls exactly SPAWN_GATE_TRIES times', () => {
    // The literal M6 mutant: `done` followed by nothing, so the function's exit
    // status is the loop's last `sleep`. And the bound must be the variable —
    // a hardcoded 450 here would make this assertion 450, not 3.
    const rc = rcOf(': > "$HOME/pane-up"; SPAWN_GATE_TRIES=3; _accept_first_run_prompts cc-test 0',
      { PANE_TEXT: 'a pane with nothing this function recognises' });
    expect(rc).toBe(4);
    expect(h.calls().filter((c) => c.includes('capture-pane')).length).toBe(3);
  });

  it('still returns 0 on a live marker and 2 on a login screen — the other two rows of the table', () => {
    // Re-pinned from ccd-login-screen.test.ts because these are no longer two
    // isolated behaviors but two rows of one four-row contract: a mutant that
    // renumbered the table would pass over there and fail here.
    expect(rcOf(': > "$HOME/pane-up"; _accept_first_run_prompts cc-test 0',
      { PANE_TEXT: '? for shortcuts' })).toBe(0);
    expect(rcOf(': > "$HOME/pane-up"; _accept_first_run_prompts cc-test 0',
      { PANE_TEXT: 'Please run /login' })).toBe(2);
  });
});

describe('_spawn: the verdict becomes a fact before it becomes a return code', () => {
  const spawnStamp = (id: string, env: NodeJS.ProcessEnv): string | null => {
    seed(id);
    // Trailing `; :` for the ccd-login-screen reason: _spawn's exit code is now
    // the verdict, so a correct rc 2 or rc 3 would make h.sh throw.
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn ${id} new; :`, env);
    return h.reg(id, 'spawn');
  };

  it('writes $REG/<id>.spawn = "<epoch> <rc>" on EVERY verdict, before returning', () => {
    // §3.1: this is the only channel from a spawn inside the supervisor to a
    // `ccd start` in another process (Task 5 reads it). A stamp written only on
    // success would leave the failures — the whole point — unreadable.
    expect(spawnStamp('healthy', { PANE_TEXT: '? for shortcuts' })).toMatch(/^\d{10} 0$/);
    expect(spawnStamp('gated', { PANE_TEXT: 'Please run /login' })).toMatch(/^\d{10} 2$/);
    expect(spawnStamp('vanished', { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' })).toMatch(/^\d{10} 3$/);
  });

  it('propagates the verdict as its own exit code', () => {
    // Kills a `_spawn` that stamps and then returns the status of its last
    // command — the shape it had before this task.
    seed('myid');
    expect(rcOf('_spawn myid new', { PANE_TEXT: '? for shortcuts' })).toBe(0);
    expect(rcOf('_spawn myid new', { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' })).toBe(3);
  });

  it('rc 4 (window expired with no live marker) also stamps the fact, warns on stderr, and skips /effort', () => {
    // Coverage gap flagged in review: rc 4 was only exercised through the
    // classifier above — _spawn's own rc-4 stamp/warning and the callers'
    // `-eq 4` guard had no assertion, so a mutant deleting `|| "$rc" -eq 4`
    // anywhere would have stayed green.
    seed('expired');
    const out = h.sh(
      `${TMUX} rm -f "$HOME/pane-up"; SPAWN_GATE_TRIES=2; _spawn expired new 2>&1; :`,
      { PANE_TEXT: 'a pane with nothing this function recognises' },
    );
    expect(h.reg('expired', 'spawn')).toMatch(/^\d{10} 4$/);
    expect(out).toContain('startup window expired with no live TUI marker');
    expect(h.calls().some((c) => c.includes('/effort'))).toBe(false);
  });

  it('propagates rc 4 as its own exit code too', () => {
    seed('expired2');
    expect(rcOf('SPAWN_GATE_TRIES=2; _spawn expired2 new',
      { PANE_TEXT: 'a pane with nothing this function recognises' })).toBe(4);
  });

  it('skips the /effort injection on every non-zero verdict, not just the login screen', () => {
    // The pre-fix guard was `prompt_rc != 2`, written when 2 was the only
    // non-zero code. Left alone it would type a slash command at a session
    // that does not exist.
    seed('myid');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn myid new; :`, { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(h.calls().some((c) => c.includes('/effort'))).toBe(false);
  });

  it('a successful spawn clears a stop stamp; a failed one leaves it standing', () => {
    // Contract: $REG/<id>.stopped is cleared by any SUCCESSFUL spawn (§4.1 —
    // reviving a session supersedes the earlier stop). A failed spawn revived
    // nothing, so it must not erase the record of who stopped it.
    seed('myid');
    h.sh(`_reg_set myid stopped '1786500000 pwa'`);
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn myid new; :`, { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(h.reg('myid', 'stopped')).toBe('1786500000 pwa');
    h.sh(`${TMUX} rm -f "$HOME/pane-up"; _spawn myid new; :`, { PANE_TEXT: '? for shortcuts' });
    expect(h.reg('myid', 'stopped')).toBeNull();
  });
});

describe('the callers M6 actually lied through', () => {
  // CCD_IN_UNIT=1 is set in these snippets so they pin the DIRECT spawn path
  // both before and after Task 5, which gives both verbs a supervised branch.
  // Until that task lands the variable is inert; after it, it is what selects
  // the path these assertions are about.
  it('ccd ensure prints no success line and exits with the verdict when the session never came up', () => {
    seed('myid');
    const r = shFail(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_ensure myid`,
      { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(r.code).toBe(3);
    expect(r.stdout).not.toContain('ensured');
    expect(r.stderr).toContain('ensure failed for myid (spawn rc 3)');
    expect(h.reg('myid', 'spawn')).toMatch(/^\d{10} 3$/);
  });

  it('ccd ensure treats rc 4 (window expired) the same as rc 3 — no success line, verdict propagated', () => {
    seed('myid4');
    const r = shFail(`${TMUX} rm -f "$HOME/pane-up"; SPAWN_GATE_TRIES=2; CCD_IN_UNIT=1; cmd_ensure myid4`,
      { PANE_TEXT: 'a pane with nothing this function recognises' });
    expect(r.code).toBe(4);
    expect(r.stdout).not.toContain('ensured');
    expect(r.stderr).toContain('ensure failed for myid4 (spawn rc 4)');
    expect(h.reg('myid4', 'spawn')).toMatch(/^\d{10} 4$/);
  });

  it('ccd start does the same — and both still report success on a healthy spawn', () => {
    h.sh(`mkdir -p "$HOME/projects/demo" "$HOME/projects/demo2"`);
    const bad = shFail(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_start claude2 demo`,
      { PANE_TEXT: '', SPAWN_MAKES_PANE: '0' });
    expect(bad.code).toBe(3);
    expect(bad.stdout).not.toContain('started claude2-demo');
    expect(bad.stderr).toContain('start failed for claude2-demo (spawn rc 3)');
    // Positive control: without it, "never print a success line" passes. A
    // FRESH id (demo2, not demo) — not a corrected "(resume)" string — because
    // pinning "(new)" against the SAME id would pin a state that cannot occur
    // in production: a --resume against a uuid a failed call minted but never
    // wrote a real transcript for (spec M7 resolves that by searching project
    // storage and finding nothing). It would also couple this control to the
    // still-under-discussion "started stays 1 on failure" policy — decoupling
    // that later should not turn a correct fix into an apparent regression
    // here. A fresh project sidesteps both.
    const good = h.sh(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_start claude2 demo2`,
      { PANE_TEXT: '? for shortcuts' });
    expect(good).toContain('started claude2-demo2 (new)');
  });

  it('ccd start treats rc 4 (window expired) the same as rc 3', () => {
    h.sh(`mkdir -p "$HOME/projects/demo4"`);
    const bad = shFail(
      `${TMUX} rm -f "$HOME/pane-up"; SPAWN_GATE_TRIES=2; CCD_IN_UNIT=1; cmd_start claude2 demo4`,
      { PANE_TEXT: 'a pane with nothing this function recognises' },
    );
    expect(bad.code).toBe(4);
    expect(bad.stdout).not.toContain('started claude2-demo4');
    expect(bad.stderr).toContain('start failed for claude2-demo4 (spawn rc 4)');
  });
});

describe('the spawn fact records rc 5, and the encoding is unchanged', () => {
  it('writes `<epoch-seconds> 5` — the timestamp is load-bearing', () => {
    seed('myid');
    h.sh(`${TMUX} _spawn myid new; :`, { PANE_TEXT: 'You have reached your usage limit' });
    // _supervised_start compares `at >= since` to tell THIS attempt's failure
    // from the previous one's; a bare word field would destroy that.
    expect(h.reg('myid', 'spawn')).toMatch(/^\d+ 5$/);
  });

  it('3 and 4 keep their numbers — four call sites plus _supervised_start branch on them', () => {
    expect(rcOf('_accept_first_run_prompts cc-test 0')).toBe(3);
  });
});

/** THE CALLERS' HALF OF rc 5, which the code shipped without.
 *
 *  Task 6 minted rc 5 and widened four `[[ "$rc" -eq 3 || "$rc" -eq 4 ]]` sites
 *  to admit it — and pinned only `_accept_first_run_prompts` RETURNING it. With
 *  every `|| "$rc" -eq 5` deleted the suite stayed green, and each verb would
 *  have printed its SUCCESS line and exited 0 over a session sitting behind a
 *  limit banner: M6 again, one code later. A verdict nobody propagates is not a
 *  verdict. */
describe('rc 5 survives the caller, not just the classifier', () => {
  const HARD_BLOCK = 'You have reached your usage limit';

  it('ccd start exits 5, prints no success line, and names the rc on stderr', () => {
    h.sh(`mkdir -p "$HOME/projects/demo5"`);
    const bad = shFail(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_start claude2 demo5`,
      { PANE_TEXT: HARD_BLOCK });
    expect(bad.code).toBe(5);
    expect(bad.stdout).not.toContain('started claude2-demo5');
    expect(bad.stderr).toContain('start failed for claude2-demo5 (spawn rc 5)');
    // The operator-facing half: rc 5 says waiting cannot fix it, so the message
    // must not read like rc 4's "try again".
    expect(bad.stderr).toContain('hard-blocked at startup');
    expect(h.reg('claude2-demo5', 'spawn')).toMatch(/^\d{10} 5$/);
  });

  it('ccd ensure does the same — the second of the four sites', () => {
    seed('blocked');
    const r = shFail(`${TMUX} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_ensure blocked`,
      { PANE_TEXT: HARD_BLOCK });
    expect(r.code).toBe(5);
    expect(r.stdout).not.toContain('ensured');
    expect(r.stderr).toContain('ensure failed for blocked (spawn rc 5)');
  });

  it('ws-add propagates it too — the workspace path is where a silent success costs a wave', () => {
    // `_spawn` stubbed to the verdict rather than driven through a pane: the
    // pane -> rc mapping is pinned above, and what is unpinned is the CALLER's
    // `-eq 5` arm. WS_ADD's own `_spawn` no-op is redefined here, later wins.
    h.makeRepo('demo');
    const bad = shFail(`${WS_ADD} _spawn() { return 5; }; CCD_WS_SLUG=quiet-mesa cmd_ws_add demo`);
    expect(bad.code).toBe(5);
    expect(bad.stdout).not.toContain('workspace claude-demo-quiet-mesa');
    expect(bad.stderr).toContain('ws-add spawn failed for');
    expect(bad.stderr).toContain('(spawn rc 5)');
  });
});
