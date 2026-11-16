// A wake or start onto an account at its ceiling moves first (D-8123, limit-swap-autofix Task 1).
//
// `cmd_ensure` / `cmd_start` outside the unit ask the unit to spawn the session on its CURRENT wrapper. When that
// wrapper's own usage already sits at SWAP_CEILING, the session would come up, hit the banner within a minute and
// only then be rescued. `_wake_ceiling_move` moves it first, to an account with MEASURED room, by dispatching
// `ccd swap` in its own transient unit (arm `wake`, no jitter, no act gate). It sends no keys, ever.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). `_supervised_start` and `_svc_run_detached` are stubs that append to
// `$HOME/ccd-calls`; the clock is ccd's own seam (`FAKE_NOW`). Neutral ids: the session `lane-a-project-a`, the fixture
// roster's wrappers (`claude`, `claude-a`, `claude-b`, `claude-d`, `gpt`).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-wake-ceiling-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000e1';
const T0 = Math.floor(Date.now() / 1000);

const seed = (wrapper = 'claude', home = 'claude'): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home ${home}
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir "$HOME/projects/project-a"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'project-a'), { recursive: true });
};
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const touchReg = (f: string): void => { fs.mkdirSync(path.dirname(regFile(f)), { recursive: true }); fs.writeFileSync(regFile(f), ''); };
/** `~/.cc-limits/<w>.json`: `five`/`seven` percentages, a fresh `ts`, optional reset epochs. */
const limits = (w: string, five: number, seven: number, opts: { fiveResetAt?: number; sevenResetAt?: number } = {}): void => {
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
    JSON.stringify({ five, seven, ts: T0, ...opts }));
};
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const regGet = (f: string): string | null => h.reg(ID, f);
const detached = (): string[] => h.calls().filter((l) => l.startsWith('detached '));
const started = (): string[] => h.calls().filter((l) => l.startsWith('supervised-start'));

/** The clock seam, a session positively gone (`_session_probe`), and the two seams the verbs end in. */
const SEAMS = `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
  _supervised_start() { echo "supervised-start $*" >> "$HOME/ccd-calls"; return 0; };
  _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };`;
const STUBS = `${SEAMS}
  _session_probe() { PROBE_VERDICT=gone; PROBE_DETAIL=""; PROBE_SUBSTRATE=present; };`;
const env = (extra: Record<string, string> = {}): Record<string, string> => ({ FAKE_NOW: String(T0), TMUX: '', ...extra });

describe('a wake or start onto an account at its ceiling moves first', () => {
  it('a wake onto an account reading seven=100 moves to the account with measured room, not the unmeasured one', () => {
    seed('claude', 'claude'); touchReg(`${ID}.hibernated`);
    limits('claude', 10, 100, { sevenResetAt: T0 + 86400 });
    limits('claude-a', 20, 30);   // measured room
    // claude-b, claude-d: no telemetry (unknown)
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    expect(detached()).toEqual([expect.stringMatching(/CCD_WAKE_MOVE=1 CCD_SWAP_AUTO=1 CCD_SWAP_ARM=wake .* swap 'lane-a-project-a' 'claude-a'/)]);
    expect(started()).toEqual([]);
    expect(lines('wake-rescue')).toEqual([expect.stringMatching(/: claude \(ceiling five=10 seven=100\) -> claude-a \[home=claude\]$/)]);
    expect(regGet('lastswap')).toBe(String(T0));
  });

  it('only unmeasured room: no move, the wake spawns where it is and says so once', () => {
    seed(); limits('claude', 100, 40);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    expect(detached()).toEqual([]);
    expect(started().length).toBe(1);
    expect(lines('wake-ceiling-stay')).toEqual([expect.stringMatching(/wake-ceiling-stay lane-a-project-a: claude at its ceiling and no account has measured room$/)]);
    expect(lines('wake-rescue')).toEqual([]);
  });

  it('an account under the ceiling: byte-identical to today (no swap.log line, supervised-start)', () => {
    seed(); limits('claude', 40, 50); limits('claude-a', 5, 5);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    expect(detached()).toEqual([]);
    expect(started().length).toBe(1);
    expect(swapLog()).toBe('');
    expect(regGet('lastswap')).toBeNull();
  });

  it('a seven-day reading whose sevenResetAt has passed is not a ceiling', () => {
    seed(); limits('claude', 10, 100, { sevenResetAt: T0 - 60 }); limits('claude-a', 5, 5);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    expect(detached()).toEqual([]);
    expect(started().length).toBe(1);
    expect(swapLog()).toBe('');
  });

  it('the swap fallback re-entering cmd_ensure (CCD_WAKE_MOVE=1) never moves again', () => {
    seed(); limits('claude', 100, 100); limits('claude-a', 5, 5);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env({ CCD_WAKE_MOVE: '1' }));
    expect(detached()).toEqual([]);
    expect(started().length).toBe(1);
    expect(swapLog()).toBe('');
  });

  it('an in-unit ensure (CCD_IN_UNIT=1) never moves', () => {
    seed(); limits('claude', 100, 100); limits('claude-a', 5, 5);
    h.sh(`${STUBS} _spawn_start() { echo "spawn-start $*" >> "$HOME/ccd-calls"; return 0; }; _spawn_settle() { return 0; }; cmd_ensure ${ID}`,
      env({ CCD_IN_UNIT: '1' }));
    expect(detached()).toEqual([]);
    expect(swapLog()).toBe('');
    expect(h.calls().some((l) => l.startsWith('spawn-start'))).toBe(true);
  });

  it('a live session is never moved by the wake path', () => {
    seed(); limits('claude', 100, 100); limits('claude-a', 5, 5);
    h.sh(`${STUBS} _session_probe() { PROBE_VERDICT=live; PROBE_DETAIL=""; PROBE_SUBSTRATE=present; }; _wake_ceiling_move ${ID}; echo "rc=$?" >> "$HOME/ccd-calls"`, env());
    expect(detached()).toEqual([]);
    expect(h.calls()).toContain('rc=1');
  });

  it('an unanswered liveness probe (tmux has-session times out) is not a dead session: nothing is dispatched', () => {
    seed(); limits('claude', 100, 100); limits('claude-a', 5, 5);
    // The real `_session_probe` over a `tmux` stub that answers like `timeout` killing a wedged server: rc 124, no output.
    const real = `tmux() { return 124; };`;
    h.sh(`${SEAMS} ${real} _wake_ceiling_move ${ID}; echo "rc=$?" >> "$HOME/ccd-calls"; _session_verdict ${ID} >> "$HOME/ccd-calls"`, env());
    expect(h.calls()).toContain('rc=1');
    expect(h.calls()).toContain('unknown');
    expect(detached()).toEqual([]);
    expect(swapLog()).toBe('');
    expect(regGet('lastswap')).toBeNull();
    // cmd_ensure falls through to the spawn it always did, and never to the swap
    h.sh(`${SEAMS} ${real} cmd_ensure ${ID}`, env());
    expect(detached()).toEqual([]);
    expect(started().length).toBe(1);
  });

  it('no tmux server at all (a cold box) is a positive absence: the wake still moves', () => {
    seed(); limits('claude', 100, 100); limits('claude-a', 5, 5);
    const cold = `tmux() { echo "no server running on /tmp/tmux-1000/default"; return 1; };`;
    h.sh(`${SEAMS} ${cold} cmd_ensure ${ID}`, env());
    expect(detached().length).toBe(1);
    expect(started()).toEqual([]);
  });

  it('a probe that errors in a way it cannot classify (permission denied) is not a dead session', () => {
    seed(); limits('claude', 100, 100); limits('claude-a', 5, 5);
    const odd = `tmux() { echo "error connecting to /tmp/tmux-1000/default (Permission denied)"; return 1; };`;
    h.sh(`${SEAMS} ${odd} cmd_ensure ${ID}`, env());
    expect(detached()).toEqual([]);
    expect(started().length).toBe(1);
  });

  it('cmd_start of a stopped session at its ceiling moves the same way', () => {
    seed(); touchReg(`${ID}.stopped`);
    limits('claude', 99, 20); limits('claude-a', 20, 30);
    h.sh(`${STUBS} cmd_start ${ID}`, env());
    expect(detached()).toEqual([expect.stringMatching(/CCD_WAKE_MOVE=1 CCD_SWAP_AUTO=1 CCD_SWAP_ARM=wake .* swap 'lane-a-project-a' 'claude-a'/)]);
    expect(started()).toEqual([]);
    expect(lines('wake-rescue')).toEqual([expect.stringMatching(/: claude \(ceiling five=99 seven=20\) -> claude-a \[home=claude\]$/)]);
  });

  it('a session that never ran (no started flag) has no transcript to carry and is not moved', () => {
    seed(); h.sh(`rm -f "$HOME/.cc-sessions/${ID}.started"`);
    limits('claude', 100, 100); limits('claude-a', 5, 5);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    expect(detached()).toEqual([]);
    expect(started().length).toBe(1);
  });

  it('a second ensure or start while the move is in flight does not dispatch a second swap', () => {
    seed(); touchReg(`${ID}.hibernated`); limits('claude', 10, 100, { sevenResetAt: T0 + 86400 }); limits('claude-a', 20, 30);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    const again = h.sh(`${STUBS} cmd_ensure ${ID}; echo "rc=$?"; cmd_start ${ID}; echo "rc=$?"`, env({ FAKE_NOW: String(T0 + 30) }));
    expect(again).toMatch(/rc=0[\s\S]*rc=0/);
    expect(detached().length).toBe(1);
    expect(started()).toEqual([]);
    expect(lines('wake-rescue').length).toBe(1);
  });

  it('once the swap has logged its own line, or the window has passed, a dead session at the ceiling moves again', () => {
    seed(); touchReg(`${ID}.hibernated`); limits('claude', 10, 100, { sevenResetAt: T0 + 86400 }); limits('claude-a', 20, 30);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    // the swap flipped the row and logged its line; the session died again inside the window: not "in flight"
    fs.appendFileSync(regFile('swap.log'), `2026-11-09 10:00:01 swap ${ID}: claude -> claude-a (uuid ${UUID})\n`);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env({ FAKE_NOW: String(T0 + 30) }));
    expect(detached().length).toBe(2);
    // a stale wake-rescue (window passed) moves again too
    h.sh(`${STUBS} cmd_ensure ${ID}`, env({ FAKE_NOW: String(T0 + 30 + 1000) }));
    expect(detached().length).toBe(3);
  });

  it('sends no keys', () => {
    seed(); touchReg(`${ID}.hibernated`); limits('claude', 100, 100); limits('claude-a', 5, 5);
    h.sh(`${STUBS} cmd_ensure ${ID}`, env());
    h.sh(`${STUBS} cmd_start ${ID}`, env());
    expect(h.calls().filter((l) => /send-keys/.test(l))).toEqual([]);
  });
});

describe('CCD_RESCUE_MEASURED_ONLY in _swap_target', () => {
  const tgt = (measuredOnly: boolean, home = 'claude'): string =>
    h.sh(`${measuredOnly ? 'export CCD_RESCUE_MEASURED_ONLY=1;' : ''} out=$(_swap_target ${ID} claude ${home} 1 0); echo "$out rc=$?"`, env());

  it('unset: an unmeasured candidate is eligible, ranked after a measured one', () => {
    seed(); limits('claude', 100, 100);
    expect(tgt(false)).toMatch(/^claude-[abd] rc=0$/);
  });

  it('set: a lone unmeasured candidate is skipped (nobody has measured room)', () => {
    seed(); limits('claude', 100, 100);
    expect(tgt(true)).toBe('rc=1');
  });

  it('set: the measured candidate is chosen over the unmeasured ones', () => {
    seed(); limits('claude', 100, 100); limits('claude-b', 30, 30);
    expect(tgt(true)).toBe('claude-b rc=0');
  });

  it('set: an unmeasured recovered home is not returned to (cur != home)', () => {
    seed('claude-a', 'claude'); limits('claude-a', 100, 100); limits('claude-b', 30, 30);
    const out = h.sh(`export CCD_RESCUE_MEASURED_ONLY=1; out=$(_swap_target ${ID} claude-a claude 1 0); echo "$out rc=$?"`, env());
    expect(out).toBe('claude-b rc=0');
    const unset = h.sh(`out=$(_swap_target ${ID} claude-a claude 1 0); echo "$out rc=$?"`, env());
    expect(unset).toBe('claude-b rc=0');   // D-8123 Task 3: a forced rescue ranks an unmeasured home after measured room
  });
});

describe('the wake arm of a swap', () => {
  it('is an automatic swap whose end cause is the generic swap-auto word (no new cause word crosses to the server)', () => {
    expect(h.sh('CCD_SWAP_AUTO=1 CCD_SWAP_ARM=wake _swap_end_cause')).toBe('swap-auto');
  });
  it('the other arms keep their words', () => {
    expect(h.sh('CCD_SWAP_AUTO=1 CCD_SWAP_ARM=rescue _swap_end_cause')).toBe('swap-auto-rescue');
    expect(h.sh('CCD_SWAP_AUTO=1 CCD_SWAP_ARM=affinity _swap_end_cause')).toBe('swap-auto-home');
    expect(h.sh('_swap_end_cause')).toBe('swap-manual');
  });
});
