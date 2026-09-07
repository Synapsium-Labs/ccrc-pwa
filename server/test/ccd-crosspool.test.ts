/**
 * `--cross-pool` — the deliberate crossing, and the marker that makes it stick
 * (spec §5.7, ruling 8).
 *
 * Without the marker the design undoes every crossing within one 5-second
 * tick: the re-seed rewrites `.home`, `_swap_target`'s `force=pool` treats the
 * crossed account as a must-leave, and the affinity arm moves the session back
 * at the next idle boundary. `prefer --cross-pool` would be a no-op.
 *
 * FIXTURE HOME ONLY (`makeCcdHarness`). Task 4's own cases below drove only
 * `_auto_swap_check` (the tick) — none of them calls a manual verb, so none
 * touched `cmd_swap`, `systemctl`/`launchctl`/`tmux`, or `TMUX` on its own.
 * Task 5 is what exercises `cmd_swap`, `--cross-pool`'s flag loop, the
 * detached self-swap retry and the deploy-window strand below, and consumes
 * every helper this file imports except `WS_ADD`, which stays unused here
 * for Task 6's `cmd_start`/`cmd_prefer` cases (`eventsOf`, `measOf`, `decOf`,
 * `logLines`, `noticeLines`, `plantNotify`, `SWAP_STUBS`, `plant` and
 * `shFail` are all live now).
 *
 * WHAT TASK 5 DELIVERED, for the manual-verb cases below: systemd and tmux
 * logging instead of acting (`SWAP_STUBS`, `SELF`); `sleep` stubbed because
 * `cmd_swap`'s flush wait is a second of real time per case; `TMUX` emptied
 * at the call site so the detached self-swap branch is never taken from a
 * suite that may itself be running inside tmux, except in the two cases that
 * are ABOUT that branch. Task 6 still owes `cmd_start --cross-pool`,
 * `cmd_prefer --cross-pool` and `cmd_ensure`'s strand clear.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, seedAccountsSh, WS_ADD, type CcdHarness } from './ccdWsHelpers.js';
import { POOLED_TEST_ROSTER } from './fixtures/poolRule.js';
import { eventsOf, measOf, decOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => {
  h = makeCcdHarness('ccrc-ccd-crosspool-');
  seedAccountsSh(h.home, POOLED_TEST_ROSTER);
});
afterEach(() => { h.cleanup(); });

const UUID = 'b7001948-2222-4bcc-b60b-0cfc0dc3d199';
const ID = 'claude-demo';
const PANE_PID = '4242';

const reg = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string =>
  fs.existsSync(reg('swap.log')) ? fs.readFileSync(reg('swap.log'), 'utf8') : '';
const logLines = (verb: string): string[] =>
  swapLog().split('\n').filter((l) => l.includes(` ${verb} `));
const notices = (): string =>
  fs.existsSync(path.join(h.home, 'notify-log'))
    ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '';
const noticeLines = (): string[] => notices().split('\n').filter(Boolean);

const plantNotify = (): void => {
  fs.writeFileSync(reg('notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
};
const tagPool = (project: string, pool: string): void => {
  fs.mkdirSync(reg('pools'), { recursive: true });
  fs.writeFileSync(path.join(reg('pools'), project), pool);
};
const writeLimits = (w: string, five: number, seven: number): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: Math.floor(Date.now() / 1000) }));
};

const SWAP_STUBS = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };'
  + ' tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; }; sleep() { :; };';

/** The registry row cmd_swap reads. Returns `mdir` — the munge of the resolved
 *  workdir, computed here exactly as ccd's `tr '/._' '---'` computes it. */
const seedRow = (wrapper = 'claude'): string => {
  const wd = path.join(h.home, 'projects', 'demo');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}
    _reg_set ${ID} wrapper ${wrapper}
    _reg_set ${ID} home ${wrapper}
    _reg_set ${ID} project demo
    _reg_set ${ID} workdir ${wd}
    _reg_set ${ID} started 1`);
  return fs.realpathSync(wd).replace(/[/._]/g, '-');
};

const plant = (cfg: string, pdir: string, body: string): void => {
  const dir = path.join(h.home, cfg, 'projects', pdir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), body);
};

const shFail = (snippet: string, env: NodeJS.ProcessEnv = {}):
{ code: number; stdout: string; stderr: string } => {
  try { return { code: 0, stdout: h.sh(snippet, env), stderr: '' }; }
  catch (e) {
    const err = e as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return { code: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
};

/** The tick, with `_swap_target` and `_auto_swap_check` REAL. */
const BLOCKED = `
  tmux() { case "\${1:-}" in
             capture-pane) echo "API Error: 429 Too Many Requests" ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const QUIET = `
  tmux() { case "\${1:-}" in
             capture-pane) printf '%s\\n' "❯ " ;;
             list-panes)   echo ${PANE_PID} ;;
           esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };
`;
const tick = (stubs: string, n = 1): string =>
  h.sh(`${stubs} for ((i=0;i<${n};i++)); do _auto_swap_check ${ID}; done`);

/** A landed crossing, written the way `cmd_swap --cross-pool` writes it, so
 *  the marker cases do not depend on Task 5's verb changes. `lastswap` is
 *  removed because a real crossing stamps it and every gate below would then
 *  close before the tick reached anything worth measuring. */
const crossed = (pool: string, acct: string): void => {
  h.sh(`_reg_set ${ID} crosspool "$(date +%s) ${pool} ${acct}"; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
};

describe('the crossing marker expires', () => {
  it('survives ten ticks while the project pool and the account both hold', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);       // crossed onto pool-b
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 99, 99);                 // home is at the ceiling: no return-home
    writeLimits('claude-b', 5, 5);
    tick(QUIET, 10);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'home')).toBe('claude');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(h.calls().join('\n'), 'the pool machinery left the row alone').not.toContain('dispatch');
  });

  it('a RETAG ends it, and swap.log says why', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    writeLimits('claude-b', 5, 5);
    tagPool('demo', 'pool-b');                     // the operator changed their mind
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: project pool is now named pool-b`);
  });

  it('an UNTAG ends it too', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    fs.rmSync(path.join(reg('pools'), 'demo'));
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: project pool is now untagged`);
  });

  it('an automatic RESCUE lands IN POOL, and the move itself ends the crossing', () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} wrapper claude-b`);
    crossed('pool-a', 'claude-b');
    writeLimits('claude', 99, 99);                 // home at the ceiling, so no return-home
    writeLimits('claude-a', 5, 5);
    tick(BLOCKED);
    expect(h.calls().join('\n'), 'automatic moves never cross').toContain(`dispatch ${ID} -> claude-a`);
    // The landing is what ends it. `_dispatch_swap` is a stub here, so do what
    // the dispatched `cmd_swap` would have done to the row.
    h.sh(`_reg_set ${ID} wrapper claude-a; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
    tick(BLOCKED);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: moved off claude-b`);
  });
});

describe('an undecidable or unreadable record decides nothing, or lies', () => {
  // Review round 1, Important 1. UNDECIDABLE IS NOT A DECISION: an unreadable
  // or malformed PROJECT tag is neither a retag, an untag, nor a move — it is
  // "nobody can say", and folding it into either arm would invent a fourth,
  // destructive way for a deliberate crossing to end. A transient permission
  // hiccup on `$POOLS_DIR` must never be able to end every live crossing on
  // the fleet box inside one tick, irreversibly. `cmd_swap --cross-pool`
  // (Task 5) is now a writer that COULD re-establish a wrongly-cleared
  // crossing, but only once an operator notices and re-issues it by hand —
  // there is still no automatic recovery, which is what this test guards.
  // Task 6 adds `start`/`prefer`'s writers.
  it.skipIf(process.getuid?.() === 0)(
    'an UNDECIDABLE project tag leaves a VALID marker untouched', () => {
      seedRow(); tagPool('demo', 'pool-a');
      h.sh(`_reg_set ${ID} wrapper claude-b`);
      crossed('pool-a', 'claude-b');
      writeLimits('claude-b', 5, 5);
      const tag = path.join(reg('pools'), 'demo');
      fs.chmodSync(tag, 0o000);              // unreadable: nobody decides
      try {
        tick(QUIET);
      } finally {
        fs.chmodSync(tag, 0o644);
      }
      expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
      expect(swapLog()).not.toContain('crosspool-ended');
    });

  // The SECOND, separate half: the MARKER's own record — not the project
  // tag — is what is broken. `pool` reads empty, so the naive reason
  // ("project pool is now $pps") would say "project pool is now named
  // pool-a" while the project pool IS, literally, still pool-a — a
  // self-contradicting line that sends the operator hunting for a retag
  // nobody performed. This must get its own third reason instead.
  it("a marker whose OWN record is unreadable ends with an honest reason, never a fabricated retag", () => {
    seedRow(); tagPool('demo', 'pool-a');
    h.sh(`_reg_set ${ID} crosspool ""; rm -f "$HOME/.cc-sessions/${ID}.lastswap"`);
    tick(QUIET);
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(swapLog()).toContain(`crosspool-ended ${ID}: marker record is unreadable`);
    expect(swapLog(), 'must not fabricate a retag the project pool never had')
      .not.toContain('project pool is now named pool-a');
  });
});

/** The self-swap fixture: `tmux display-message` answers with this session's
 *  own name and TMUX is set, so `cmd_swap` takes the detach arm. The SEAM is
 *  shadowed rather than the tool — `_svc_run_detached` is what ccd calls, and
 *  only its Linux arm is systemd-run. */
const SELF = `
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
  tmux() { case "\${1:-}" in display-message) echo "cc-${ID}";; esac;
    echo "tmux $*" >> "$HOME/ccd-calls"; return 0; };
  _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };
`;

describe('cmd_swap refuses a crossing that was not asked for', () => {
  it('dies BEFORE the detach arm — synchronously, with nothing dispatched', () => {
    // The guard slot matters: below the detach arm this refusal would happen in
    // a process nobody is waiting for, and the PWA's 502 would carry nothing.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const r = shFail(`${SELF} cmd_swap ${ID} claude-b`, { TMUX: '/tmp/x,1,0' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      "pool-mismatch: claude-b is in pool 'pool-b' and project 'demo' is in pool 'pool-a'");
    expect(r.stderr).toContain(`ccd swap --cross-pool ${ID} claude-b`);
    expect(h.calls().join('\n'), 'the detach arm was never reached').not.toContain('detached');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('`--force` is NOT the override — it means transcript loss and nothing else', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    const r = shFail(`${SWAP_STUBS} cmd_swap --force ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('pool-mismatch: claude-b is in pool');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    // Review round 1, Important 2. `CCD_SWAP_AUTO` is unset on this call (a
    // shell invocation, not a dispatched unit), so the strand-mark inside the
    // guard's else arm must not fire — an operator's plain mistyped swap (or
    // the same tap from the PWA) is not the deploy-window scenario §5.8.4
    // exists for, and must not write `.stranded`, log a `stranded` line, or
    // burn the strand-notify floor against the next GENUINE strand.
    expect(h.reg(ID, 'stranded')).toBeNull();
  });

  it('refuses on an UNDECIDABLE tag even with the flag — nobody decides, so nobody crosses', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'Pool Orate');
    const r = shFail(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' });
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(
      `pool tag for demo is malformed: ${h.home}/.cc-sessions/pools/demo`);
    expect(r.stderr).toContain('nothing was touched');
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });
});

describe('cmd_swap crosses on purpose', () => {
  it('writes the marker, ONE `cross-pool` line and `dec.crosspool 1`', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    expect(h.sh(`${SWAP_STUBS} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '' }))
      .toContain(`swapped ${ID}: claude -> claude-b`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'crosspool')).toMatch(/^\d{10} pool-a claude-b$/);
    expect(logLines('cross-pool')).toHaveLength(1);
    expect(swapLog()).toContain(
      `cross-pool ${ID}: claude -> claude-b [project=demo pool=pool-a target-pool=pool-b]`);
    const rows = eventsOf(h.home, 'swap');
    expect(rows).toHaveLength(1);
    expect(decOf(rows[0]!)['crosspool']).toBe('1');
    expect(measOf(rows[0]!)).toMatchObject({ from: 'claude', wrapper: 'claude-b' });
  });

  it('writes NO marker and no crossing flag for an ordinary in-pool swap', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(h.reg(ID, 'crosspool')).toBeNull();
    expect(logLines('cross-pool')).toHaveLength(0);
    expect(decOf(eventsOf(h.home, 'swap')[0]!)['crosspool']).toBeUndefined();
  });

  it('the detached retry keeps the operator`s decision — the flag rides the unit argv', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    h.sh(`${SELF} cmd_swap --cross-pool ${ID} claude-b`, { TMUX: '/tmp/x,1,0' });
    const argv = h.calls().filter((c) => c.startsWith('detached ')).join('\n');
    expect(argv, 'the detach really happened').toContain(`swap`);
    expect(argv).toContain('--cross-pool');
    // Logged ONCE, at the success tail: this arm re-execs and runs the guard a
    // second time, so a line written at the guard would be written twice.
    expect(logLines('cross-pool')).toHaveLength(0);
    // Review round 1, Important 1. The detach arm RETURNS before the carry
    // ever runs — nothing has moved yet, the re-exec'd unit is what will
    // actually do it — so the marker must not exist on THIS process's
    // registry. `_crosspool_mark` belongs solely at the success tail; written
    // at the guard instead, it would name a crossing this call never
    // performed, and a later death (a failed transcript pre-flight, a
    // missing config-dir mapping, `systemd-run` itself failing) would leave
    // it standing — the pool machinery switched off for good on an account
    // the session never reached.
    expect(h.reg(ID, 'crosspool')).toBeNull();
  });

  it('a landed swap CLEARS a standing strand', () => {
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    h.sh(`_reg_set ${ID} stranded "1700000000 no candidate"`);
    h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-a`, { TMUX: '' });
    expect(h.reg(ID, 'stranded')).toBeNull();
    expect(logLines('unstranded')).toHaveLength(1);
  });

  it('a STANDING crossing lets the same target land with NO flag — the automatic path`s own escape', () => {
    // Review round 1, Important 3. This is the arm `_swap_target`'s "home
    // recovered, go back" branch and `_auto_swap_check`'s own dispatch
    // (CCD_SWAP_AUTO=1, no --cross-pool) depend on: the pool machinery
    // itself chose this exact move once, under a marker that still stands,
    // so the guard must not re-refuse it as an undeclared crossing. Without
    // this arm every such automatic move would strand the row and banner
    // the operator every SWAP_COOLDOWN — silently, because nothing in this
    // suite exercises `cmd_swap` with a standing marker AND no flag.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n'); tagPool('demo', 'pool-a');
    crossed('pool-a', 'claude-b');
    expect(h.sh(`${SWAP_STUBS} cmd_swap ${ID} claude-b`, { TMUX: '' }))
      .toContain(`swapped ${ID}: claude -> claude-b`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-b');
    expect(h.reg(ID, 'stranded')).toBeNull();
  });
});

describe('the deploy window (§5.8.4)', () => {
  it('an old supervisor`s pool-blind choice is refused LOUDLY inside the unit', () => {
    // The pre-deploy inode is modelled by stubbing `_swap_target` to the
    // pool-blind answer it used to give; `_dispatch_swap` runs the NEW
    // `cmd_swap` in-process with the environment the real one sets.
    const mdir = seedRow(); plant('.claude', mdir, 'HISTORY\n');
    tagPool('demo', 'pool-a'); plantNotify();
    const OLD_SUPERVISOR = `
      systemctl() { :; }; launchctl() { :; }; sleep() { :; };
      tmux() { case "\${1:-}" in capture-pane) echo "API Error: 429 Too Many Requests";; esac; return 0; };
      _swap_target() { echo claude-b; };
      # A SUBSHELL, because that is what the real one is: _dispatch_swap runs
      # cmd_swap in a transient systemd unit, and cmd_swap's guard reaches
      # \`die\` (echo + exit 1). In-process that would exit the whole test shell.
      _dispatch_swap() { ( CCD_SWAP_AUTO=1 cmd_swap "$1" "$2" ) >/dev/null 2>&1 || true; };`;
    h.sh(`${OLD_SUPERVISOR} _auto_swap_check ${ID}`);
    expect(h.reg(ID, 'wrapper'), 'nothing moved').toBe('claude');
    expect(h.reg(ID, 'stranded')).toMatch(/^\d{10} /);
    expect(noticeLines()).toHaveLength(1);
    // Review round 1, Important 4. PINNED WHOLE, not by prefix: the stock
    // "no account in pool $pdesc can take it" sentence is FALSE here — an
    // in-pool account (claude-a) genuinely could take the session — so the
    // banner must say what actually happened (an undeclared crossing this
    // guard refused) rather than a misleading pool census. MEASURED.
    expect(noticeLines()[0]).toBe(
      `cc swap STRANDED: ${ID} is blocked on claude — claude-b refused as a `
      + 'cross-pool crossing nobody asked for — likely a supervisor still '
      + 'running a pre-deploy ccd; the remedy is the claude-session@* unit sweep');
    expect(h.reg(ID, 'lastswap'),
      'the stamp stays: retracting it would re-dispatch the same choice every 5 s')
      .toMatch(/^\d{10}$/);
  });

  it('_dispatch_swap really sets CCD_SWAP_AUTO in the unit it launches', () => {
    seedRow();
    h.sh('_svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };'
      + ` _dispatch_swap ${ID} claude-a`);
    const argv = h.calls().filter((c) => c.startsWith('detached ')).join('\n');
    // Review round 1, Minor 1: placement-aware, not merely present-anywhere.
    // `CCD_SWAP_AUTO=1 exec …` exports it into the re-exec'd `ccd`'s
    // environment; `CCD_SWAP_AUTO=1;` (a bare assignment, semicolon-terminated
    // with no `exec` after it) would satisfy `.toContain('CCD_SWAP_AUTO=1')`
    // while never actually reaching the child process — a mutation that made
    // the whole deploy-window mechanism inert while this suite stayed green.
    expect(argv).toContain('CCD_SWAP_AUTO=1 exec ');
  });
});
