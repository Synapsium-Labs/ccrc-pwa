// A lone rescue's jitter is capped (D-8123, limit-swap-autofix Task 7).
//
// `_dispatch_swap` delays every dispatched swap by a random 0..SWAP_JITTER seconds (120) so that a fleet-wide event
// (a window rolling over, a spend cap tripping) does not restart every affected session in one second: that herd stalled
// the box for hours on 2026-08-14. A rescue that is the ONLY dispatch in flight is not a herd, and the 0..120 s wait is
// a minute of a session sitting on its limit for nothing. `_rescue_jitter_max <id> <arm>` therefore prints
// min(SWAP_JITTER, CCRC_RESCUE_SOLO_JITTER_S) (a box setting, default 15) for a `rescue` or `watchdog` dispatch when no
// OTHER session's `lastswap` is inside SWAP_JITTER + 60 s, and SWAP_JITTER for everything else (an affinity move, or a
// rescue while another dispatch is in flight). The dispatch line in swap.log carries ` max=<n>` so the spread that
// applied is readable afterwards. Nothing here ever sends a key: the rescue ends the session and resumes it on another
// account.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). `_svc_run_detached` is stubbed to record the unit's command (the `sleep N`), and
// `_jitter_draw` is stubbed to return the ceiling it is given, so the bound is asserted exactly. Neutral ids only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ghContainedEnv, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rescue-jitter-solo-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const OTHER = 'lane-a-project-b';

const STUBS = `
  _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; }
  _jitter_draw() { echo "$1"; }`;

/** `$REG/swap.log` lines that are dispatches. */
const dispatchLines = (): string[] => {
  const p = path.join(h.home, '.cc-sessions', 'swap.log');
  return (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n') : []).filter((l) => / dispatch /.test(l));
};

/** Stamp a session's `lastswap` `agoS` seconds in the past (the real clock). */
const stampSwap = (id: string, agoS: number): void => {
  h.sh(`_reg_set ${id} lastswap $(( $(date +%s) - ${agoS} ))`);
};

/** Dispatch one swap for ID with `arm` and return its swap.log line; `pre` runs first in the same shell.
 *  The session's pending-dispatch claim (Task 8) is cleared first: each call stands for a fresh decision after the last
 *  one's unit has finished, which is what `cmd_swap` does on its way out. */
const dispatchLine = (arm: string, pre = '', env: NodeJS.ProcessEnv = {}): string => {
  h.sh(`${STUBS}\nrm -f "$HOME/.cc-sessions/${ID}.dispatching"\n${pre}\n_dispatch_swap ${ID} claude-a ${arm}`, env);
  const lines = dispatchLines();
  expect(lines.length).toBeGreaterThan(0);
  return lines[lines.length - 1]!;
};
const ccrcEnv = (text: string): void => {
  fs.mkdirSync(path.join(h.home, '.ccrc'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.ccrc', 'ccrc.env'), text);
};
const sleeps = (): string[] => h.calls().filter((l) => l.startsWith('detached ')).map((l) => (/sleep (\d+);/.exec(l) ?? [])[1] ?? '');

describe('a lone rescue is capped (D-8123)', () => {
  it('a lone rescue draws from 0..15', () => {
    stampSwap(ID, 0);   // the caller stamps its own lastswap just before it dispatches
    expect(dispatchLine('rescue')).toMatch(/dispatch lane-a-project-a -> claude-a \(in 15s\) max=15$/);
    expect(sleeps()).toEqual(['15']);
  });

  it('a lone watchdog dispatch is capped the same way', () => {
    stampSwap(ID, 0);
    expect(dispatchLine('watchdog')).toMatch(/\(in 15s\) max=15$/);
  });

  it('a rescue with another session dispatched 30 s ago keeps 0..120', () => {
    stampSwap(ID, 0); stampSwap(OTHER, 30);
    expect(dispatchLine('rescue')).toMatch(/\(in 120s\) max=120$/);
    expect(sleeps()).toEqual(['120']);
  });

  it('another session dispatched just inside SWAP_JITTER + 60 s still counts; just past it does not', () => {
    stampSwap(ID, 0); stampSwap(OTHER, 170);
    expect(dispatchLine('rescue')).toMatch(/max=120$/);
    stampSwap(OTHER, 190);
    expect(dispatchLine('rescue')).toMatch(/max=15$/);
  });

  it('the dispatching session\'s own lastswap never counts as another dispatch', () => {
    stampSwap(ID, 5);
    expect(dispatchLine('rescue')).toMatch(/max=15$/);
  });

  it('an affinity move always keeps 0..120, alone or not', () => {
    stampSwap(ID, 0);
    expect(dispatchLine('affinity')).toMatch(/\(in 120s\) max=120$/);
  });

  it('a call with no arm (an older caller) keeps 0..120', () => {
    stampSwap(ID, 0);
    h.sh(`${STUBS}\n_dispatch_swap ${ID} claude-a`);
    expect(dispatchLines().pop()).toMatch(/max=120$/);
  });

  it('a torn or non-numeric lastswap on another session is no dispatch in flight', () => {
    stampSwap(ID, 0);
    h.sh(`printf %s garbage > "$HOME/.cc-sessions/${OTHER}.lastswap"`);
    expect(dispatchLine('rescue')).toMatch(/max=15$/);
  });
});

describe('the setting, and the old spread (D-8123)', () => {
  it('CCRC_RESCUE_SOLO_JITTER_S=0 in ccrc.env: a lone rescue goes at once', () => {
    ccrcEnv('CCRC_RESCUE_SOLO_JITTER_S=0\n');
    stampSwap(ID, 0);
    expect(dispatchLine('rescue')).toMatch(/\(in 0s\) max=0$/);
    expect(sleeps()).toEqual(['0']);
  });

  it('a value in ccrc.env sets the ceiling', () => {
    ccrcEnv('CCRC_RESCUE_SOLO_JITTER_S=40\n');
    stampSwap(ID, 0);
    expect(dispatchLine('rescue')).toMatch(/max=40$/);
  });

  it('the environment wins over ccrc.env', () => {
    ccrcEnv('CCRC_RESCUE_SOLO_JITTER_S=40\n');
    stampSwap(ID, 0);
    expect(dispatchLine('rescue', '', { CCRC_RESCUE_SOLO_JITTER_S: '7' })).toMatch(/max=7$/);
  });

  it('a refused value reads as the default 15, with a warning', () => {
    ccrcEnv('CCRC_RESCUE_SOLO_JITTER_S=500\n');
    stampSwap(ID, 0);
    const out = h.sh(`${STUBS}\n_dispatch_swap ${ID} claude-a rescue 2>&1 >/dev/null`);
    expect(dispatchLines().pop()).toMatch(/max=15$/);
    expect(out).toMatch(/CCRC_RESCUE_SOLO_JITTER_S must be a whole number of seconds from 0 to 120/);
  });

  it('the cap never exceeds SWAP_JITTER', () => {
    stampSwap(ID, 0);
    expect(dispatchLine('rescue', 'SWAP_JITTER=10')).toMatch(/\(in 10s\) max=10$/);
  });

  it('SWAP_JITTER=0 still means no delay at all, for every arm', () => {
    stampSwap(ID, 0); stampSwap(OTHER, 30);
    expect(dispatchLine('rescue', 'SWAP_JITTER=0')).toMatch(/\(in 0s\) max=0$/);
    expect(dispatchLine('affinity', 'SWAP_JITTER=0')).toMatch(/\(in 0s\) max=0$/);
  });

  it('the setting is read once per process, not once per dispatch', () => {
    stampSwap(ID, 0);
    ccrcEnv('CCRC_RESCUE_SOLO_JITTER_S=40\n');
    h.sh(`${STUBS}
      _dispatch_swap ${ID} claude-a rescue
      rm -f "$REG/${ID}.dispatching"   # the first unit has finished (Task 8's claim)
      printf 'CCRC_RESCUE_SOLO_JITTER_S=3\\n' > "$HOME/.ccrc/ccrc.env"
      _dispatch_swap ${ID} claude-a rescue`);
    expect(dispatchLines().map((l) => /max=(\d+)$/.exec(l)?.[1])).toEqual(['40', '40']);
  });

  it('a settings library that is missing reads the default, and the dispatch still happens', () => {
    // ccd copied beside no lib/ and with no ~/.local/libexec/ccrc/ccrc-settings.sh in the fixture HOME.
    const bare = path.join(h.home, 'bare');
    fs.mkdirSync(bare, { recursive: true });
    fs.copyFileSync(CCD, path.join(bare, 'ccd'));
    stampSwap(ID, 0);
    const r = spawnSync('bash', ['-c', 'a_src=$A_SRC a_snip=$A_SNIP; unset A_SRC A_SNIP; source "$a_src"; eval "$a_snip"'], {
      env: ghContainedEnv(h.home, { ...h.env(), A_SRC: path.join(bare, 'ccd'), A_SNIP: `${STUBS}\n_dispatch_swap ${ID} claude-a rescue` },
        { systemd: true, tmux: true, net: true }),
      cwd: h.home, encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(0);
    expect(dispatchLines().pop()).toMatch(/\(in 15s\) max=15$/);
    expect(r.stderr).toMatch(/ccrc-settings\.sh/);
  });
});

describe('hostile registry fields (D-8123)', () => {
  it('an arithmetic payload planted in another session\'s lastswap is never evaluated', () => {
    stampSwap(ID, 0);
    h.sh(`printf %s 'REG[$(touch "$HOME/PWNED-lastswap")]' > "$HOME/.cc-sessions/${OTHER}.lastswap"`);
    expect(dispatchLine('rescue')).toMatch(/max=15$/);
    expect(fs.existsSync(path.join(h.home, 'PWNED-lastswap'))).toBe(false);
  });

  it('a hostile SWAP_JITTER is no delay and is never evaluated', () => {
    stampSwap(ID, 0);
    expect(dispatchLine('rescue', `SWAP_JITTER='REG[$(touch "$HOME/PWNED-jitter")]'`)).toMatch(/\(in 0s\) max=0$/);
    expect(fs.existsSync(path.join(h.home, 'PWNED-jitter'))).toBe(false);
  });
});

describe('no key is ever sent (D-8123)', () => {
  it('a dispatch sends no key to any pane', () => {
    stampSwap(ID, 0);
    dispatchLine('rescue');
    expect(h.calls().filter((l) => /send-keys/.test(l))).toEqual([]);
  });
});
