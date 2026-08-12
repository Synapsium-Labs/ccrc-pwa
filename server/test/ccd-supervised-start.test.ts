// §3.1/§3.2: the human start path goes through the unit instead of around it.
// Before this, `ccd stop` was `systemctl --user disable --now` and `ccd start`
// was a bare `_spawn`, so stop-then-start left a pane with no unit: no
// supervise loop, therefore no _sync_uuid, no _auto_swap_check, no
// _auto_compact_check, and nothing to record its death.
//
// The unit is modelled by ONE file, $HOME/pane-up: `systemctl … enable --now`
// creates it (that is what a unit does — starts a supervisor that spawns a
// pane), `disable --now` removes it, and `tmux has-session` answers from it.
// Every systemctl and tmux argv lands in $HOME/ccd-calls, which is where "left
// the unit enabled" reads its evidence. Nothing here reaches real systemd.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-supstart-'); });
afterEach(() => { h.cleanup(); });

const UNIT = `sleep() { :; };
  systemctl() {
    echo "systemctl $*" >> "$HOME/ccd-calls"
    case "$*" in
      "--user enable --now "*)  : > "$HOME/pane-up" ;;
      "--user disable --now "*) rm -f "$HOME/pane-up" ;;
    esac
    return 0
  };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      new-session)  : > "$HOME/pane-up" ;;
      kill-session) rm -f "$HOME/pane-up" ;;
      has-session)  [[ -e "$HOME/pane-up" ]] ;;
      capture-pane) printf '%s' '? for shortcuts' ;;
    esac
  };`;

/** A substrate where no pane ever appears. `cmd_supervise`'s watch loop then
 *  exits on its first `_alive`, which is what makes the supervisor's own
 *  startup observable without leaving a `while` running under the test. */
const NO_PANE = `sleep() { :; };
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in has-session) return 1 ;; capture-pane) printf '' ;; esac
  };`;

const shFail = (snippet: string, env: NodeJS.ProcessEnv = {}): { code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

const sysCalls = (): string[] => h.calls().filter((c) => c.startsWith('systemctl '));

const seed = (id: string): void => {
  h.sh(`_reg_set ${id} wrapper claude
        _reg_set ${id} workdir '${h.home}'
        _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
};

/** The dispatcher run as a PROGRAM with tmux and systemctl shadowed on PATH —
 *  the only way to stub `cmd_attach`'s final `exec tmux attach`, which replaces
 *  the shell and so cannot see a shell function. Same idiom as
 *  ccd-archive.test.ts's runCcd, and through ghContainedEnv so this PATH cannot
 *  displace the poisoned `gh`. */
const runCcd = (...args: string[]): { code: number; stdout: string; stderr: string } => {
  const stub = path.join(h.home, 'stubbin');
  fs.mkdirSync(stub, { recursive: true });
  fs.writeFileSync(path.join(stub, 'tmux'),
    '#!/bin/sh\necho "tmux $*" >> "$HOME/ccd-calls"\n'
    + 'case "$1" in\n'
    + '  has-session) [ -e "$HOME/pane-up" ] || exit 1 ;;\n'
    + "  capture-pane) printf '%s' '? for shortcuts' ;;\n"
    + 'esac\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(stub, 'systemctl'),
    '#!/bin/sh\necho "systemctl $*" >> "$HOME/ccd-calls"\n'
    + 'case "$*" in\n  "--user enable --now "*) : > "$HOME/pane-up" ;;\nesac\nexit 0\n', { mode: 0o755 });
  const opts = {
    encoding: 'utf8' as const, cwd: h.home,
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` }),
  };
  try { return { code: 0, stdout: execFileSync('bash', [CCD, ...args], opts).trim(), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? '').trim(), stderr: String(err.stderr ?? '') };
  }
};

describe('stop then start leaves the unit ENABLED', () => {
  it('emits exactly disable --now, reset-failed, enable --now — never a bare `start`', () => {
    // THE defect, in one sequence. A `systemctl --user start` here would bring
    // the pane back with the unit still disabled — supervised until the next
    // reboot and then gone — which is the shape M5 measured three of. And
    // reset-failed must PRECEDE the enable: §3.3 deliberately creates failed
    // units, and a failed unit refuses to start until its failure is cleared,
    // so without that link the verb advertised as "what revives it" would not.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} cmd_stop claude2-demo; cmd_start claude2 demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user disable --now claude-session@claude2-demo',
      'systemctl --user reset-failed claude-session@claude2-demo',
      'systemctl --user enable --now claude-session@claude2-demo',
    ]);
    expect(out).toContain('started claude2-demo');
    // The verb did not spawn anything itself — the unit did.
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(false);
  });

  it('ccd enable is ccd start under another name — one enable, not a second act', () => {
    // §3.1: `enable` keeps its name because the agent whitelist and CCD_ARGV
    // grant both words separately and whitelist-subset layer 3 fails on a grant
    // no route builds. A leftover second `enable --now` in cmd_enable would be
    // a redundant systemd round-trip on every create.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} cmd_enable claude2 demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@claude2-demo',
      'systemctl --user enable --now claude-session@claude2-demo',
    ]);
    expect(out).toContain('enabled boot-persistence for claude2-demo');
  });
});

describe('cmd_enable reconciles a session that is already alive', () => {
  it('does not claim boot-persistence it never created — M5\'s shape, from the keyboard', () => {
    // Review finding, CRITICAL: cmd_start's already-alive branch returns before
    // it ever reaches _supervised_start, so cmd_enable on a LIVE pane with no
    // unit issued ZERO systemctl calls while still printing "enabled
    // boot-persistence for <id>" and returning 0 — a false success line, the
    // exact M6 family this plan exists to kill, and it lands precisely on the
    // row this task exists to fix: a live pane, no unit, no supervisor, no
    // self-heal (§3.2's self-heal only runs from INSIDE a unit that is already
    // running). `ccd enable` is the last remedy for that row; it must actually
    // apply one.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} : > "$HOME/pane-up"; cmd_enable claude2 demo`);
    expect(sysCalls()).toEqual(['systemctl --user enable claude-session@claude2-demo']);
    expect(out).toContain('enabled boot-persistence for claude2-demo');
  });

  it('a bare ccd start on the same row reconciles it too — the fix lives in the shared alive branch cmd_enable aliases through', () => {
    // cmd_enable IS cmd_start plus one echo (§3.1), so the reconcile line lives
    // in cmd_start's already-alive branch, not duplicated in cmd_enable. A
    // plain `ccd start` benefits identically — self-healing an M5 row does not
    // require remembering to type `enable` — and the call is a harmless,
    // idempotent no-op the next time either verb runs.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} : > "$HOME/pane-up"; cmd_start claude2 demo`);
    expect(sysCalls()).toEqual(['systemctl --user enable claude-session@claude2-demo']);
    expect(out).toContain('already running: claude2-demo');
  });

  it('never duplicates the call a fresh start already made — one enable, whichever verb triggered it', () => {
    // The counterpart to the pre-existing "one enable, not a second act" test:
    // the alive-branch reconcile line must not ALSO fire on the fresh-start
    // path, which already ran `enable --now` inside `_supervised_start`
    // moments earlier. Not alive at the start of this call, so it takes the
    // fresh-start branch, never the alive one.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} cmd_start claude2 demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@claude2-demo',
      'systemctl --user enable --now claude-session@claude2-demo',
    ]);
    expect(out).toContain('started claude2-demo');
  });
});

describe('the recursion guard is an in-process variable', () => {
  it('an ensure INSIDE the unit spawns directly and issues no systemctl at all', () => {
    // If ensure re-entered `systemctl start` on its own unit, the supervisor
    // would be asking systemd to start the thing systemd is currently starting.
    seed('myid');
    const out = h.sh(`${UNIT} rm -f "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_ensure myid`);
    expect(out).toBe('ensured myid (new)');
    expect(sysCalls()).toEqual([]);
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
  });

  it('cmd_supervise heals its own boot-persistence at entry — enable, no --now — and its ensure adds nothing', () => {
    // §3.2's self-heal: creating the enable symlink is idempotent and safe from
    // inside the unit, and that one line fixes M5's three rows the next time
    // each supervisor restarts, with no fleet-wide scan. Exactly one systemctl
    // call, and it carries no `--now`: an `--now` here is the recursion.
    seed('myid');
    const r = shFail(`${NO_PANE} cmd_supervise myid`);
    expect(r.code).toBe(1);   // no session -> the watch loop exits for systemd
    expect(sysCalls()).toEqual(['systemctl --user enable claude-session@myid']);
  });
});

describe('the start waits on observables', () => {
  it('reports the unit\'s own verdict, read from the registry rather than guessed', () => {
    // Task 4's $REG/<id>.spawn is the only channel from a spawn inside the
    // supervisor to a `ccd start` in another process. Here the "unit" spawns
    // and fails: no pane ever appears, and the stamp is what the verb reports.
    seed('myid');
    const r = shFail(`sleep() { :; };
      systemctl() {
        echo "systemctl $*" >> "$HOME/ccd-calls"
        case "$*" in "--user enable --now "*) echo "$(date +%s) 3" > "$REG/myid.spawn" ;; esac
        return 0
      };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 1 ;; esac; };
      cmd_ensure myid`);
    expect(r.code).toBe(3);
    expect(r.stdout).not.toContain('ensured');
    expect(r.stderr).toContain('failed to start: spawn rc 3');
  });

  it('a STALE failure stamp is not this call\'s verdict', () => {
    // Kills the mutant that drops the "newer than the moment we started" check
    // and reports the last failure this row ever had as though it were now's.
    // SUPERVISED_START_WAIT=3 so a lost bound fails fast instead of hanging.
    seed('myid');
    h.sh(`_reg_set myid spawn '1 3'`);
    const r = shFail(`${NO_PANE} SUPERVISED_START_WAIT=3; cmd_ensure myid`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no pane appeared within 3s');
    expect(r.stderr).not.toContain('spawn rc 3');
  });

  it('attach revives a dead row through the unit and lands on a pane that exists', () => {
    // ccd:7180 is `_alive || cmd_ensure` then `exec tmux attach` — delegating
    // the spawn made that asynchronous, so without the wait the attach races a
    // pane that is not there yet.
    seed('claude2-demo');
    const r = runCcd('attach', 'claude2', 'demo');
    expect(r.code).toBe(0);
    const calls = h.calls();
    const enableAt = calls.indexOf('systemctl --user enable --now claude-session@claude2-demo');
    const attachAt = calls.indexOf('tmux attach -t cc-claude2-demo');
    expect(enableAt).toBeGreaterThan(-1);
    expect(attachAt).toBeGreaterThan(enableAt);
  });

  it('writes `started` even when the supervised start fails — the row still classifies orphan, not never-started', () => {
    // Review finding, IMPORTANT: Task 4's invariant ("started stays
    // unconditional... a spawn that failed is still a row that was started")
    // lives on the in-unit cmd_ensure branch, which a crash-looped FAILED
    // unit — exactly the shape this task's own StartLimitBurst is designed to
    // produce — may never reach even once from THIS process's point of view.
    // The outer cmd_ensure/cmd_start must uphold the same invariant on its
    // own, not depend on an inner process it does not wait for completing a
    // write. Same substrate as "reports the unit's own verdict" above.
    seed('myid');
    expect(h.reg('myid', 'started')).toBeNull();
    shFail(`sleep() { :; };
      systemctl() {
        echo "systemctl $*" >> "$HOME/ccd-calls"
        case "$*" in "--user enable --now "*) echo "$(date +%s) 3" > "$REG/myid.spawn" ;; esac
        return 0
      };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) return 1 ;; esac; };
      cmd_ensure myid`);
    expect(h.reg('myid', 'started')).toBe('1');
  });

  it('writes `started` on the bound-timeout failure too, not only on a reported spawn rc', () => {
    // The other exit from _supervised_start's wait loop — no pane, no fresh
    // spawn stamp at all within the window — must uphold the same invariant.
    seed('myid');
    expect(h.reg('myid', 'started')).toBeNull();
    shFail(`${NO_PANE} SUPERVISED_START_WAIT=1; cmd_ensure myid`);
    expect(h.reg('myid', 'started')).toBe('1');
  });

  it('a malformed spawn-rc field is not trusted as a return code', () => {
    // Review finding, MINOR: `return` truncates its argument mod 256, so an
    // unvalidated rc from a corrupted stamp could come back 0 (success) on a
    // real failure — measured, "1000" truncates to 232, and anything ≡0 mod
    // 256 would lie outright. Unreachable in production (only `_spawn` writes
    // this field, always two fields in one `printf`) but defended anyway: an
    // out-of-range rc must be treated as an unusable stamp, so the call falls
    // through to the ordinary "no pane appeared" timeout instead of returning
    // (or worse, silently succeeding on) the bogus value.
    seed('myid');
    h.sh(`_reg_set myid spawn "$(date +%s) 1000"`);
    const r = shFail(`${NO_PANE} SUPERVISED_START_WAIT=1; cmd_ensure myid`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no pane appeared within 1s');
    expect(r.stderr).not.toContain('spawn rc');
  });
});

describe('when systemd is not there, the start still happens and says so', () => {
  it('falls back to a direct spawn and warns that nothing is watching', () => {
    // §3.1: a start that cannot be supervised is still better than no start; a
    // start that is SILENTLY unsupervised is the defect. _have_systemctl is its
    // own function for the reason _ws_supervise is: a test can stub it.
    seed('myid');
    const out = h.sh(`${UNIT} _have_systemctl() { return 1; }; rm -f "$HOME/pane-up"; cmd_ensure myid 2>&1`);
    expect(out).toContain('systemctl not found — starting myid UNSUPERVISED');
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
    expect(sysCalls()).toEqual([]);
  });

  it('an enable that fails takes the same lane, warning and all', () => {
    // No unit installed, no lingering: `enable --now` is what answers non-zero,
    // and a silent swallow here is the old behavior wearing a new name.
    seed('myid');
    const out = h.sh(`sleep() { :; };
      systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; case "$2" in enable) return 1 ;; esac; return 0; };
      tmux() {
        echo "tmux $*" >> "$HOME/ccd-calls"
        case "$1" in
          new-session) : > "$HOME/pane-up" ;;
          has-session) [[ -e "$HOME/pane-up" ]] ;;
          capture-pane) printf '%s' '? for shortcuts' ;;
        esac
      };
      cmd_ensure myid 2>&1`);
    expect(out).toContain('could not enable unit claude-session@myid — starting myid UNSUPERVISED');
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(true);
  });
});
