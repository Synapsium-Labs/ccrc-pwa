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
import { CCD, ghContainedEnv, harnessBin, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

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
 *  exits on its first probe, which is what makes the supervisor's own
 *  startup observable without leaving a `while` running under the test.
 *
 *  `has-session` SAYS tmux's own death sentence rather than failing silently:
 *  since D-B8-14 the watch loop is verdict-driven, and a bare rc 1 with no
 *  message classifies `unknown` — which refuses to exit by design, so the old
 *  silent stub would hang this suite's `cmd_supervise` case under an
 *  execFileSync with no timeout. Boolean callers (`_alive`) are unmoved:
 *  `gone` and `unknown` are both "not alive". */
const NO_PANE = `sleep() { :; };
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  tmux() {
    echo "tmux $*" >> "$HOME/ccd-calls"
    case "$1" in
      has-session)  echo "can't find session: $3" >&2; return 1 ;;
      capture-pane) printf '' ;;
    esac
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
  // harnessBin(), not a private dir: ghContainedEnv PREPENDS the harness bin,
  // so a stub anywhere else can never win. Writing here REPLACES the contained
  // systemctl/tmux for this test, which is what these two files need — and the
  // replacement STICKS, because the systemd poison is create-if-absent while
  // this write is unconditional.
  const stub = harnessBin(h.home);
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
    env: ghContainedEnv(h.home,
      { ...process.env, HOME: h.home, PATH: `${stub}:${process.env.PATH ?? ''}` }, { systemd: true, tmux: true }),
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
    const out = h.sh(`${UNIT} cmd_stop claude-a-demo; cmd_start claude-a demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user disable --now claude-session@claude-a-demo',
      'systemctl --user reset-failed claude-session@claude-a-demo',
      'systemctl --user enable --now claude-session@claude-a-demo',
    ]);
    expect(out).toContain('started claude-a-demo');
    // The verb did not spawn anything itself — the unit did.
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(false);
  });

  it('ccd enable is ccd start under another name — one enable, not a second act', () => {
    // §3.1: `enable` keeps its name because the agent whitelist and CCD_ARGV
    // grant both words separately and whitelist-subset layer 3 fails on a grant
    // no route builds. A leftover second `enable --now` in cmd_enable would be
    // a redundant systemd round-trip on every create.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} cmd_enable claude-a demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@claude-a-demo',
      'systemctl --user enable --now claude-session@claude-a-demo',
    ]);
    expect(out).toContain('enabled boot-persistence for claude-a-demo');
  });
});

describe('cmd_enable reconciles a session that is already alive', () => {
  /** A live pane the supervisor IS watching: `_session_state` reads `running`,
   *  which is the row the alive branch must stay cheap for.
   *
   *  THE CLAIM IS PART OF THE FIXTURE, not decoration. A fresh heartbeat alone
   *  no longer makes a row `running`: Wave 1 put `unclaimed` first inside the
   *  alive branch, so a live pane with a heartbeat and NO `started` is F8's
   *  residue — a row `_resupervise_live` is now supposed to adopt AND claim.
   *  Seeding only `supervised` here described `running` in the docstring while
   *  planting `unclaimed` on disk, and the case would have passed for the wrong
   *  reason (gate miss, not cheapness). */
  const beat = (id: string): void => {
    h.sh(`_reg_claim ${id}; _reg_set ${id} supervised "$(date +%s)"`);
  };

  it('adopts a live pane no supervisor is watching — M5\'s shape, from the keyboard', () => {
    // Review finding, CRITICAL, in two rounds. Round one: cmd_start's
    // already-alive branch returns before it ever reaches _supervised_start, so
    // cmd_enable on a LIVE pane with no unit issued ZERO systemctl calls while
    // still printing "enabled boot-persistence for <id>" and returning 0 — a
    // false success line on precisely the row this task exists to fix.
    //
    // FINAL REVIEW: the line that fixed it was `enable` WITHOUT `--now`, which
    // promises a start at next boot and supervises nothing now — so the row
    // stayed `unsupervised`, and the PWA kept rendering "running unsupervised"
    // beside a Restart button that changed nothing. On deploy day that row is
    // not a corner case, it is D2's entire population: every pane a pre-fix
    // `ccd start` minted reads `unsupervised`. `--now` is what actually adopts
    // it, and `reset-failed` must precede it for §3.3's reason.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} : > "$HOME/pane-up"; cmd_enable claude-a demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@claude-a-demo',
      'systemctl --user enable --now claude-session@claude-a-demo',
    ]);
    expect(out).toContain('re-supervised claude-a-demo');
    expect(out).toContain('enabled boot-persistence for claude-a-demo');
    // The adoption is not a second spawn: the unit re-enters through
    // `cmd_ensure`, which finds the pane and returns.
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(false);
  });

  it('a bare ccd start on the same row adopts it too — the fix lives in the shared alive branch cmd_enable aliases through', () => {
    // cmd_enable IS cmd_start plus one echo (§3.1), so the reconcile line lives
    // in cmd_start's already-alive branch, not duplicated in cmd_enable. A
    // plain `ccd start` benefits identically — recovering an unsupervised row
    // does not require remembering to type `enable`.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} : > "$HOME/pane-up"; cmd_start claude-a demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@claude-a-demo',
      'systemctl --user enable --now claude-session@claude-a-demo',
    ]);
    expect(out).toContain('already running: claude-a-demo');
  });

  it('a live pane that IS being watched costs one idempotent enable and no --now', () => {
    // The other half of the same branch, and the one that stops the fix above
    // from becoming "every start round-trips systemd twice". A `running` row
    // needs only the boot-persistence symlink reconciled; an `--now` here would
    // be a restart request against a unit that is already running the session.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    h.sh(`${UNIT} : > "$HOME/pane-up"`);
    beat('claude-a-demo');
    const out = h.sh(`${UNIT} : > "$HOME/pane-up"; cmd_start claude-a demo`);
    expect(sysCalls()).toEqual(['systemctl --user enable claude-session@claude-a-demo']);
    expect(out).toContain('already running: claude-a-demo');
    expect(out).not.toContain('re-supervised');
  });
});

describe('ccd ensure revives a live-but-unsupervised session', () => {
  // THE ccd HALF OF A PWA FINDING (final review). `POST /api/sessions/:id/ensure`
  // is the Restart button's actual route, and `cmd_ensure`'s `if _alive; then
  // echo "alive: $id"; return 0; fi` ran BEFORE every side effect — so on the
  // one row the PWA labels "running unsupervised" the button returned success
  // and did nothing at all. Measured before the fix: state `unsupervised`
  // before, `unsupervised` after, zero systemctl calls.
  const seedLive = (id: string): void => {
    h.sh(`_reg_set ${id} wrapper claude
          _reg_set ${id} workdir '${h.home}'
          _reg_set ${id} project demo
          _reg_set ${id} started 1
          _reg_set ${id} uuid deadbeef-0000-4000-8000-000000000000`);
  };

  /** `UNIT` plus the one thing a real unit does that the shared stub does not
   *  model: `ExecStart=ccd supervise %i` stamps `$REG/<id>.supervised` on
   *  entry (§4.2). Without it "the unit started" and "a supervisor is watching"
   *  are indistinguishable here, and this describe is entirely about the
   *  difference. */
  const UNIT_SUP = `${UNIT}
    systemctl() {
      echo "systemctl $*" >> "$HOME/ccd-calls"
      local u
      case "$*" in
        "--user enable --now claude-session@"*)
          : > "$HOME/pane-up"; u="$4"; _reg_set "\${u##*@}" supervised "$(date +%s)" ;;
      esac
      return 0
    };`;

  it('adopts the pane, and the row stops reading `unsupervised`', () => {
    seedLive('myid');
    const out = h.sh(`${UNIT_SUP} : > "$HOME/pane-up"
      _session_state myid
      cmd_ensure myid
      _session_state myid`);
    expect(out.split('\n')).toEqual([
      'unsupervised',
      're-supervised myid — a live pane with no supervisor; its unit has adopted it',
      'alive: myid',
      'running',
    ]);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@myid',
      'systemctl --user enable --now claude-session@myid',
    ]);
    // No second pane, and the live one is untouched — the whole reason this is
    // `enable --now` and not a `_spawn`.
    expect(h.calls().some((c) => c.startsWith('tmux new-session'))).toBe(false);
    expect(h.calls().some((c) => c.startsWith('tmux kill-session'))).toBe(false);
  });

  it('stays the cheap no-op it has always been for a supervised live session', () => {
    // The contract the PWA half depends on in the other direction: `ensure` is
    // reachable on every row, so a healthy fleet must not pay a systemd
    // round-trip per click.
    seedLive('myid');
    h.sh(`_reg_set myid supervised "$(date +%s)"`);
    const out = h.sh(`${UNIT} : > "$HOME/pane-up"; cmd_ensure myid`);
    expect(out).toBe('alive: myid');
    expect(sysCalls()).toEqual([]);
  });

  it('never fires from inside the unit — that ensure IS the supervisor', () => {
    // `cmd_supervise` stamps `supervised` and then calls `cmd_ensure` with
    // CCD_IN_UNIT set; a re-supervise there would be the unit asking systemd to
    // start the unit systemd is currently starting (§3.2's recursion, by
    // another door). Stamp deliberately absent, so the ONLY thing keeping this
    // quiet is the guard.
    seedLive('myid');
    const out = h.sh(`${UNIT} : > "$HOME/pane-up"; CCD_IN_UNIT=1; cmd_ensure myid`);
    expect(out).toBe('alive: myid');
    expect(sysCalls()).toEqual([]);
  });

  it('says so on stderr when the unit will not start, instead of reporting a revival', () => {
    // The fallback half: a box with no unit installed cannot adopt anything,
    // and the row is still unsupervised afterwards. Silence here would be the
    // same false success the fix exists to remove.
    seedLive('myid');
    const NOUNIT = `sleep() { :; };
      systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 1; };
      tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; case "$1" in has-session) [[ -e "$HOME/pane-up" ]] ;; esac; };`;
    // Captured through a file, not through a thrown exec: `cmd_ensure` returns
    // 0 on this path (the pane really is alive), so the warning would be
    // invisible to a helper that only reads stderr on a non-zero exit.
    const out = h.sh(`${NOUNIT} : > "$HOME/pane-up"; cmd_ensure myid 2>"$HOME/ensure-err"`);
    expect(out).toBe('alive: myid');
    expect(fs.readFileSync(path.join(h.home, 'ensure-err'), 'utf8'))
      .toContain('myid is alive but UNSUPERVISED and its unit would not start');
    expect(h.sh(`${NOUNIT} _session_state myid`)).toBe('unsupervised');
  });

  it('never duplicates the call a fresh start already made — one enable, whichever verb triggered it', () => {
    // The counterpart to the pre-existing "one enable, not a second act" test:
    // the alive-branch reconcile line must not ALSO fire on the fresh-start
    // path, which already ran `enable --now` inside `_supervised_start`
    // moments earlier. Not alive at the start of this call, so it takes the
    // fresh-start branch, never the alive one.
    h.sh(`mkdir -p "$HOME/projects/demo"`);
    const out = h.sh(`${UNIT} cmd_start claude-a demo`);
    expect(sysCalls()).toEqual([
      'systemctl --user reset-failed claude-session@claude-a-demo',
      'systemctl --user enable --now claude-session@claude-a-demo',
    ]);
    expect(out).toContain('started claude-a-demo');
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
    // ccd:11309-11310 is `_alive || cmd_ensure` then `exec tmux attach` — delegating
    // the spawn made that asynchronous, so without the wait the attach races a
    // pane that is not there yet.
    seed('claude-a-demo');
    const r = runCcd('attach', 'claude-a', 'demo');
    expect(r.code).toBe(0);
    const calls = h.calls();
    const enableAt = calls.indexOf('systemctl --user enable --now claude-session@claude-a-demo');
    const attachAt = calls.indexOf('tmux attach -t cc-claude-a-demo');
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

// §1.1 — THE ORDERING, ON THE TWO PATHS THAT HAVE NO UNIT TO FALL BACK ON.
// New scope the spec did not originally cover: a fallback that still
// spawns-first re-opens F8's hole on exactly the boxes least able to recover —
// no systemd at all, or a unit that will not enable. There is no
// `_ws_supervise` on either path by construction; that is what "UNSUPERVISED"
// in the warnings above means, so the claim is the only write there is to
// order.
describe('_supervised_start\'s fallbacks take the split form', () => {
  /** The two halves, RECORDING — and the settle records the CLAIM AS IT STOOD
   *  WHEN IT RAN. That `started=` field is the whole discriminator: stubbing
   *  the two halves alone proves nothing, because `_spawn` is their composition
   *  and calls both either way. Only "what was written before the blocking half
   *  began" separates the split form from the old spawn-then-claim.
   *
   *  `_spawn_start` answers in the GLOBAL and prints nothing (D-B8-1): an
   *  `echo 0` stub would model the shape this build exists to keep out, and
   *  would leak `0` onto the caller's stdout. */
  const HALVES = `_spawn_start() { echo "spawn_start $1 $2" >> "$HOME/ccd-calls"; SPAWN_FROMSWAP=0; };
    _spawn_settle() { echo "spawn_settle $1 $2 started=[$(_reg_get "$1" started)]" >> "$HOME/ccd-calls"; return 0; };`;

  it('the no-systemctl fallback claims BETWEEN the halves', () => {
    seed('claude-demo');
    h.sh(`_have_systemctl() { return 1; }
          ${HALVES}
          _supervised_start claude-demo 2>/dev/null; :`);
    expect(h.calls()).toEqual([
      'spawn_start claude-demo new',
      'spawn_settle claude-demo 0 started=[1]',
    ]);
    expect(h.reg('claude-demo', 'started')).toBe('1');
  });

  it('the enable-failed fallback does the same — the boxes least able to recover', () => {
    seed('claude-demo');
    h.sh(`systemctl() { case "$*" in *"enable --now"*) return 1 ;; esac; return 0; }
          ${HALVES}
          _supervised_start claude-demo 2>/dev/null; :`);
    expect(h.calls()).toEqual([
      'spawn_start claude-demo new',
      'spawn_settle claude-demo 0 started=[1]',
    ]);
    expect(h.reg('claude-demo', 'started')).toBe('1');
  });

  it('picks resume when the row is already claimed', () => {
    seed('claude-demo');
    h.sh(`_reg_claim claude-demo
          _have_systemctl() { return 1; }
          ${HALVES}
          _supervised_start claude-demo 2>/dev/null; :`);
    expect(h.calls()).toContain('spawn_start claude-demo resume');
  });

  it('the claim still lands when the settle FAILS — an orphan, not a never-started row', () => {
    // The whole reason the claim is written on attempt rather than on success.
    seed('claude-demo');
    h.sh(`_have_systemctl() { return 1; }
          _spawn_start() { SPAWN_FROMSWAP=0; };
          _spawn_settle() { return 4; };
          _supervised_start claude-demo 2>/dev/null; :`);
    expect(h.reg('claude-demo', 'started')).toBe('1');
  });

  it('neither fallback wraps _spawn_start in a command substitution (D-B8-1)', () => {
    // `$(_spawn_start …)` demotes its `die` to rc 1, which is in no caller's
    // failure set. Structural, because the behavioural pin lives one file over.
    const body = h.sh('type _supervised_start');
    expect(body).not.toMatch(/\$\(\s*_spawn_start/);
    expect(body).toContain('SPAWN_FROMSWAP');
  });
});
