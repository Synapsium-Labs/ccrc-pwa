/**
 * Swap guards, `ccd` half (D-5240; spec 2026-10-16 §5.9).
 *
 * A swap is decided on one tick and acted on later, inside a transient unit,
 * after a jitter of up to two minutes. Everything this file pins is about that
 * gap: what the act re-measures, what it refuses, and what a refusal leaves
 * behind. Every refusal must leave no `.choicekept` marker, no `degraded`
 * stamp, no account write the decision made and no stopped pane, because each
 * of those is a write the stop path makes and only a swap that happens may
 * make them.
 *
 * THE FIXTURE. A fixture HOME (`makeCcdHarness`), a stubbed `tmux` whose
 * answers come from files in HOME (`pane` is what `capture-pane` prints,
 * `tmux-name` what `display-message -p '#S'` prints, `narrow` makes the width
 * query fail), logged `systemctl`/`launchctl`, a no-op `sleep`, and a
 * `_svc_run_detached` that RECORDS the `bash -c` string it was handed instead
 * of starting a unit. `act()` then runs that recorded string inline, with the
 * re-exec of the real binary turned into a call of `cmd_swap` in the same
 * shell, so the environment `_dispatch_swap` composes is the one the act
 * reads: the transient unit's `bash -c`, run by a stubbed systemd-run.
 *
 * Neutral ids throughout (public repository): the session `lane-a-project-a`,
 * the fixture roster's own wrappers (`claude`, `claude-d`, `gpt`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
import { eventsOf } from './lifecycleHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-swap-guards-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-000000000001';
const PID = '4242';
const nowS = (): number => Math.floor(Date.now() / 1000);
const reg = (): string => path.join(h.home, '.cc-sessions');
const regPath = (field: string): string => path.join(reg(), `${ID}.${field}`);
const cfgOf: Record<string, string> = { claude: '.claude', 'claude-d': '.claude-d', gpt: '.claude-gpt' };

const STUBS = `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) [[ -e "$HOME/narrow" ]] && return 1; echo "1 200"; return 0 ;; esac
    case "\${1:-}" in
      capture-pane)    cat "$HOME/pane" 2>/dev/null ;;
      list-panes)      echo ${PID} ;;
      display-message) case "$*" in *'#S'*) cat "$HOME/tmux-name" 2>/dev/null ;; esac ;;
    esac; return 0; };
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };
  cmd_ensure() { echo "cmd_ensure $*" >> "$HOME/ccd-calls"; return 0; };
  _svc_run_detached() { printf '%s\\n' "$3" >> "$HOME/detached"; return 0; };
  _swap_target() { echo claude-d; }; _avail() { return 0; };
`;
/** The rc-6 decision: a destination chosen one rung down (\`fable\` -> \`opus\`). */
const RUNG = '_rescue_target() { echo claude-d; return 6; };';
/** \`_operator_choice_keep\` logs what the \`degraded\` field held when it ran — the call-order probe. */
const KEEP_PROBE = `_operator_choice_keep() { echo "choicekeep degraded=$(cat "$REG/${ID}.degraded" 2>/dev/null)" >> "$HOME/ccd-calls"; _reg_set "$1" choicekept 1; };`;

const calls = (): string[] => h.calls();
const stopped = (): boolean => calls().some((l) => /kill-session|(systemctl|launchctl) .*(stop|bootout|kill)/.test(l));
const swapLog = (): string => {
  const p = path.join(reg(), 'swap.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
};
const notes = (): string[] => {
  const p = path.join(h.home, 'notify-log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const detached = (): string[] => {
  const p = path.join(h.home, 'detached');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean) : [];
};
const limitsFile = (w = 'gpt'): string => path.join(h.home, '.cc-limits', `${w}.json`);
const pane = (text: string): void => { fs.writeFileSync(path.join(h.home, 'pane'), `${text}\n`); };

/** The registry row, its transcript, a notify.sh that logs. Returns the transcript path. */
const seed = (wrapper: string, home = 'claude-d'): string => {
  const wd = path.join(h.home, 'projects', 'project-a');
  fs.mkdirSync(wd, { recursive: true });
  h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper ${wrapper}; _reg_set ${ID} home ${home}
    _reg_set ${ID} project project-a; _reg_set ${ID} workdir ${wd}; _reg_set ${ID} class fable`);
  const mdir = fs.realpathSync(wd).replace(/[/._]/g, '-');
  const dir = path.join(h.home, cfgOf[wrapper]!, 'projects', mdir);
  fs.mkdirSync(dir, { recursive: true });
  const tx = path.join(dir, `${UUID}.jsonl`);
  fs.writeFileSync(tx, '{"type":"user","message":{"role":"user","content":"go on"}}\n');
  fs.writeFileSync(path.join(reg(), 'notify.sh'),
    '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
  return tx;
};
/** Claude Code's live file for the pane's process; absent = unreadable. */
const live = (wrapper: string, status: string, suaMs = 1): void => {
  const dir = path.join(h.home, cfgOf[wrapper]!, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({ pid: Number(PID), status, statusUpdatedAt: suaMs }));
};
const noLive = (wrapper: string): void => {
  fs.rmSync(path.join(h.home, cfgOf[wrapper]!, 'sessions', `${PID}.json`), { force: true });
};

const decide = (extra = ''): string => h.sh(`${STUBS} ${extra} _auto_swap_check ${ID}`, { TMUX: '' });
/** Run the newest recorded \`bash -c\` string inline: the binary's re-exec becomes \`cmd_swap\`. */
const act = (extra = '', env: NodeJS.ProcessEnv = { TMUX: '' }): string => h.sh(`${STUBS} ${extra}
  s=$(tail -n1 "$HOME/detached"); re="exec '[^']*' swap"
  [[ $s =~ $re ]] && s="\${s/"\${BASH_REMATCH[0]}"/cmd_swap}"
  ( eval "$s" ); echo "rc=$?"`, env);
/** A manual (or detached) \`cmd_swap\` whose exit and stderr are the answer. */
const manual = (args: string, env: NodeJS.ProcessEnv = { TMUX: '' }, extra = ''): { rc: number; err: string; out: string } => {
  const out = h.sh(`${STUBS} ${extra} ( cmd_swap ${args} ) 2>"$HOME/err"; echo "rc=$?"`, env);
  const rc = Number(/rc=(\d+)\s*$/.exec(out)?.[1] ?? 'NaN');
  return { rc, out, err: fs.readFileSync(path.join(h.home, 'err'), 'utf8') };
};

// ── the automatic affinity arm ───────────────────────────────────────────────
describe('an automatic affinity swap re-runs its idle gate at the act', () => {
  /** Returns the prior \`lastswap\` it seeded, computed once (a second re-computation races the clock). */
  const decideIdle = (extra = ''): string => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    const prev = String(nowS() - 5000);
    fs.writeFileSync(regPath('lastswap'), prev);
    decide(extra);
    expect(detached(), 'the control: the decision dispatched').toHaveLength(1);
    return prev;
  };

  it('a pane that turned busy during the jitter re-queues: lastswap restored, nothing stopped, no .choicekept', () => {
    const prev = decideIdle();
    live('claude', 'busy');
    expect(act()).toContain('rc=0');
    expect(swapLog()).toContain(`requeue ${ID}: busy after jitter`);
    expect(h.reg(ID, 'lastswap'), 'lastswap restored to the decision\'s prior value').toBe(prev);
    expect(stopped(), 'systemctl stop / kill-session never called').toBe(false);
    expect(fs.existsSync(regPath('choicekept')), 'no .choicekept left behind').toBe(false);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('with no lastswap before the decision, a re-queue removes the one the decision stamped', () => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    decide();
    expect(h.reg(ID, 'lastswap')).not.toBeNull();
    live('claude', 'busy');
    act();
    expect(h.reg(ID, 'lastswap')).toBeNull();
  });

  it('a pane that went narrow during the jitter re-queues: an unmeasurable pane is never read idle', () => {
    decideIdle();
    fs.writeFileSync(path.join(h.home, 'narrow'), '');
    act();
    expect(swapLog()).toContain(`requeue ${ID}: busy after jitter`);
    expect(stopped()).toBe(false);
  });

  it('still idle at the act: the swap proceeds', () => {
    decideIdle();
    act();
    expect(swapLog()).toContain(`swap ${ID}: claude -> claude-d`);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
  });
});

// ── the degrade stamp moves to the act ───────────────────────────────────────
describe('the degrade stamp is written at the act, after the gates', () => {
  it('the decision carries the rung into the unit and stamps nothing itself', () => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    decide(RUNG);
    const s = detached()[0] ?? '';
    expect(s).toMatch(/CCD_SWAP_DFROM=fable/);
    expect(s).toMatch(/CCD_SWAP_DTO=opus/);
    expect(s).toMatch(/CCD_SWAP_ARM=affinity/);
    expect(h.reg(ID, 'degraded'), 'not stamped at the decision').toBeNull();
  });

  it('a re-queued swap decided with a rung leaves no degraded stamp and no route row', () => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    decide(RUNG);
    live('claude', 'busy');
    act(RUNG);
    expect(swapLog()).toContain(`requeue ${ID}`);
    expect(h.reg(ID, 'degraded')).toBeNull();
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
  });

  it('a swap that proceeds is stamped once, before _operator_choice_keep', () => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    decide(RUNG);
    act(`${RUNG} ${KEEP_PROBE}`);
    expect(h.reg(ID, 'degraded')).toBe('opus');
    expect(eventsOf(h.home, 'route')).toHaveLength(1);
    expect(calls(), 'the stamp stood when the keep ran').toContain('choicekeep degraded=opus');
  });

  it('a stamp that cannot be written stands still: lastswap restored, nothing stopped', () => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    fs.writeFileSync(regPath('lastswap'), '1000');
    decide(RUNG);
    fs.mkdirSync(regPath('degraded'));
    act(RUNG);
    expect(swapLog()).toContain(`degrade-unwritable ${ID}: fable -> opus`);
    expect(h.reg(ID, 'lastswap')).toBe('1000');
    expect(stopped()).toBe(false);
    expect(fs.existsSync(regPath('choicekept'))).toBe(false);
  });

  it('the same on a RESCUE: the limits row comes back, .rescueprev goes, the authdead marker stays', () => {
    const tx = seed('gpt'); void tx;
    const prior = '{"five":40,"seven":10,"ts":1700000000}';
    fs.writeFileSync(limitsFile(), prior);
    pane('API Error: 429 Too Many Requests');
    decide(RUNG);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toMatch(/^\{"five":100,"seven":0,"ts":\d+\}$/);
    fs.writeFileSync(path.join(reg(), 'gpt-authdead'), `${nowS()} rescue-401`);
    fs.mkdirSync(regPath('degraded'));
    act(RUNG);
    expect(stopped()).toBe(false);
    expect(fs.readFileSync(limitsFile(), 'utf8'), 'the prior bytes are back').toBe(prior);
    expect(fs.existsSync(regPath('rescueprev'))).toBe(false);
    expect(fs.existsSync(path.join(reg(), 'gpt-authdead')), 'the credential verdict is left').toBe(true);
  });

  it('the unwritable-stamp rescue with an ABSENT prior removes the row', () => {
    seed('gpt');
    pane('API Error: 429 Too Many Requests');
    decide(RUNG);
    fs.mkdirSync(regPath('degraded'));
    act(RUNG);
    expect(fs.existsSync(limitsFile())).toBe(false);
  });
});

// ── the rescue arm ───────────────────────────────────────────────────────────
describe('a rescue re-confirms the block at the act, on a measured answer only', () => {
  const PRIOR = '{"five":40,"seven":10,"ts":1700000000}';
  let prevSwap = '';
  /** A normal assistant reply, then the API error the rescue is for: what a real transcript holds BEFORE the decision. */
  const HISTORY = '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"earlier reply"}]}}\n'
    + '{"type":"assistant","isApiErrorMessage":true,"error":"rate_limit","message":{"role":"assistant","content":[{"type":"text","text":"API Error: 429"}]}}\n';
  const decideRescue = (prior: string | null = PRIOR, history = false): string => {
    const tx = seed('gpt');
    if (history) fs.appendFileSync(tx, HISTORY);
    if (prior !== null) fs.writeFileSync(limitsFile(), prior);
    pane('API Error: 429 Too Many Requests');
    prevSwap = String(nowS() - 5000);
    fs.writeFileSync(regPath('lastswap'), prevSwap);
    decide();
    expect(detached(), 'the control: the rescue dispatched').toHaveLength(1);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toMatch(/^\{"five":100,"seven":0,"ts":\d+\}$/);
    return tx;
  };
  const decidedTs = (): string => /"ts":(\d+)/.exec(fs.readFileSync(limitsFile(), 'utf8'))![1]!;

  it('the decision saves the prior bytes beside the row before it overwrites them', () => {
    decideRescue();
    const saved = fs.readFileSync(regPath('rescueprev'), 'utf8');
    expect(saved).toBe(`${decidedTs()}\n${PRIOR}`);
  });

  it('banner gone and the transcript verdict negative: rescue-cancel, prior bytes back, nothing stopped', () => {
    decideRescue();
    pane('❯ ');
    act();
    expect(swapLog()).toContain(`rescue-cancel ${ID}: no longer blocked (negative)`);
    expect(stopped()).toBe(false);
    expect(fs.existsSync(regPath('choicekept'))).toBe(false);
    expect(h.reg(ID, 'degraded')).toBeNull();
    expect(eventsOf(h.home, 'route')).toHaveLength(0);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toBe(PRIOR);
    expect(fs.existsSync(regPath('rescueprev'))).toBe(false);
    expect(h.reg(ID, 'lastswap'), 'lastswap restored').toBe(prevSwap);
    expect(h.reg(ID, 'wrapper')).toBe('gpt');
  });

  it('a cancel whose prior was ABSENT removes the row', () => {
    decideRescue(null);
    expect(fs.readFileSync(regPath('rescueprev'), 'utf8')).toBe(`${decidedTs()} absent\n`);
    pane('❯ ');
    act();
    expect(swapLog()).toContain('rescue-cancel');
    expect(fs.existsSync(limitsFile())).toBe(false);
  });

  it('a cancel leaves the rescue-401 authdead marker the decision wrote', () => {
    decideRescue();
    const marker = path.join(reg(), 'gpt-authdead');
    fs.writeFileSync(marker, `${nowS()} rescue-401`);
    pane('❯ ');
    act();
    expect(swapLog()).toContain('rescue-cancel');
    expect(fs.existsSync(marker)).toBe(true);
  });

  it('a cancel leaves a NEWER writer\'s limits row untouched', () => {
    decideRescue();
    const newer = `{"five":100,"seven":0,"ts":${Number(decidedTs()) + 7}}`;
    fs.writeFileSync(limitsFile(), newer);
    pane('❯ ');
    act();
    expect(swapLog()).toContain('rescue-cancel');
    expect(fs.readFileSync(limitsFile(), 'utf8')).toBe(newer);
  });

  it('a draft at the act backs off and undoes nothing', () => {
    decideRescue();
    const marker = path.join(reg(), 'gpt-authdead');
    fs.writeFileSync(marker, `${nowS()} rescue-401`);
    pane('❯ half a sentence');
    fs.writeFileSync(regPath('tscan'), `${nowS()} 1`);
    act();
    expect(swapLog()).toContain(`rescue-backoff ${ID}: draft`);
    expect(h.reg(ID, 'lastswap'), 'a back-off restores lastswap').toBe(prevSwap);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toMatch(/"five":100/);
    expect(fs.existsSync(marker)).toBe(true);
    expect(stopped()).toBe(false);
    expect(fs.existsSync(regPath('rescueprev'))).toBe(false);
  });

  it('a fresh stale-press at the act backs off and undoes nothing', () => {
    decideRescue();
    pane('❯ ');
    fs.writeFileSync(regPath('stalepress'), `${nowS()}`);
    act();
    expect(swapLog()).toContain(`rescue-backoff ${ID}: stalepress`);
    expect(h.reg(ID, 'lastswap'), 'a back-off restores lastswap').toBe(prevSwap);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toMatch(/"five":100/);
    expect(stopped()).toBe(false);
  });

  it('a running turn at the act backs off and undoes nothing', () => {
    decideRescue();
    pane('✻ Working… (esc to interrupt)');
    act();
    expect(swapLog()).toContain(`rescue-backoff ${ID}: running`);
    expect(h.reg(ID, 'lastswap'), 'a back-off restores lastswap').toBe(prevSwap);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toMatch(/"five":100/);
    expect(stopped()).toBe(false);
  });

  it('an unmeasurable pane proceeds as decided and undoes nothing, over a transcript with earlier replies', () => {
    const tx = decideRescue(PRIOR, true);
    pane('❯ ');
    fs.writeFileSync(path.join(h.home, 'narrow'), '');
    // Something after the decision, so the offset is read at all (an unchanged size answers no before it).
    fs.appendFileSync(tx, '{"type":"assistant","isApiErrorMessage":true,"error":"rate_limit","message":{"role":"assistant","content":[{"type":"text","text":"API Error: 429"}]}}\n');
    act();
    expect(swapLog()).not.toMatch(/rescue-cancel|rescue-backoff/);
    expect(swapLog()).toContain(`swap ${ID}: gpt -> claude-d`);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toMatch(/"five":100/);
  });

  it('still blocked, but the transcript gained an assistant entry since the decision: back off', () => {
    const tx = decideRescue();
    pane('❯ ');
    fs.writeFileSync(regPath('tscan'), `${nowS()} 1`);
    fs.appendFileSync(tx, '{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}\n');
    act();
    expect(swapLog()).toContain(`rescue-backoff ${ID}: output since decision`);
    expect(h.reg(ID, 'lastswap'), 'a back-off restores lastswap').toBe(prevSwap);
    expect(fs.readFileSync(limitsFile(), 'utf8')).toMatch(/"five":100/);
    expect(stopped()).toBe(false);
  });

  it('still blocked, and the only new entry is an API error: proceed (earlier replies before the decision do not count)', () => {
    const tx = decideRescue(PRIOR, true);
    pane('❯ ');
    fs.writeFileSync(regPath('tscan'), `${nowS()} 1`);
    fs.appendFileSync(tx, '{"type":"assistant","isApiErrorMessage":true,"error":"rate_limit","message":{"role":"assistant","content":[{"type":"text","text":"API Error: 429"}]}}\n');
    act();
    expect(swapLog()).not.toMatch(/rescue-backoff|rescue-cancel/);
    expect(swapLog()).toContain(`swap ${ID}: gpt -> claude-d`);
  });
});

// ── the manual arm ───────────────────────────────────────────────────────────
describe('a manual swap needs --interrupt over a busy session, and refuses an unreadable one', () => {
  it('busy, no flag: session-busy, the pane untouched, no .choicekept', () => {
    seed('claude'); pane('❯ '); live('claude', 'busy');
    const r = manual(`${ID} claude-d`);
    expect(r.rc).not.toBe(0);
    expect(r.err).toMatch(/^ccd: session-busy: /);
    expect(stopped()).toBe(false);
    expect(fs.existsSync(regPath('choicekept'))).toBe(false);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('busy, --interrupt: proceeds', () => {
    seed('claude'); pane('❯ '); live('claude', 'busy');
    const r = manual(`--interrupt ${ID} claude-d`);
    expect(r.rc).toBe(0);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
  });

  it('idle: proceeds without the flag', () => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    expect(manual(`${ID} claude-d`).rc).toBe(0);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
  });

  it('an unreadable status refuses status-unknown, and --interrupt does not override it', () => {
    seed('claude'); pane('❯ '); noLive('claude');
    const a = manual(`${ID} claude-d`);
    expect(a.rc).not.toBe(0);
    expect(a.err).toMatch(/^ccd: status-unknown: /);
    const b = manual(`--interrupt ${ID} claude-d`);
    expect(b.rc).not.toBe(0);
    expect(b.err).toMatch(/^ccd: status-unknown: /);
    expect(stopped()).toBe(false);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });
});

describe('the detach path', () => {
  const inside = (): NodeJS.ProcessEnv => {
    fs.writeFileSync(path.join(h.home, 'tmux-name'), `cc-${ID}\n`);
    return { TMUX: '/tmp/fixture-tmux,1,0' };
  };

  it('a busy session swapping itself without --interrupt is refused synchronously, never detached', () => {
    seed('claude'); pane('❯ '); live('claude', 'busy');
    const r = manual(`${ID} claude-d`, inside());
    expect(r.rc).not.toBe(0);
    expect(r.err).toMatch(/session-busy/);
    expect(r.out).not.toMatch(/detached:/);
    expect(detached()).toHaveLength(0);
  });

  it('with --interrupt the re-run carries the flag, and running it inline proceeds', () => {
    seed('claude'); pane('❯ '); live('claude', 'busy');
    const env = inside();
    const r = manual(`--interrupt ${ID} claude-d`, env);
    expect(r.out).toMatch(/detached:/);
    expect(detached()[0]).toMatch(/swap .*--interrupt/);
    act('', env);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
  });

  it('a refusal inside the detached re-run is logged and notified, never through _swap_refuse', () => {
    seed('claude'); pane('❯ '); noLive('claude');
    fs.writeFileSync(regPath('lastswap'), '1234');
    const r = manual(`--interrupt ${ID} claude-d`, { TMUX: '', CCD_SWAP_DETACHED: '1' });
    expect(r.rc).toBe(1);
    expect(swapLog()).toContain(`swap-refused-status ${ID}: claude -> claude-d (status-unknown)`);
    expect(notes()).toHaveLength(1);
    expect(notes()[0]).toContain(`cc swap NOT DONE: ${ID} stays on claude`);
    expect(fs.existsSync(regPath('swapblocked')), 'no swapblocked stamp').toBe(false);
    expect(h.reg(ID, 'lastswap'), 'lastswap exactly as it was').toBe('1234');
  });

  it('swap-self from inside a busy session detaches with --interrupt and the job proceeds', () => {
    seed('claude'); pane('❯ '); live('claude', 'busy');
    const env = inside();
    const out = h.sh(`${STUBS} cmd_swap_self claude-d`, env);
    expect(out).toMatch(/detached:/);
    expect(detached()[0]).toMatch(/--interrupt/);
    act('', env);
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
  });
});

describe('ccd caps', () => {
  it('advertises swap-busy-v1', () => {
    expect(h.sh('cmd_caps').split('\n')).toContain('swap-busy-v1');
  });
});

// ── a woken row takes no cosmetic swap (`hibernate-long-idle-sessions` (D-5242)) ──
// A wake is a cold `--resume`; an affinity move straight after it would pay a second one. `.woke` (the epoch
// `ensure` writes when it clears `.hibernated`) holds the affinity arm for SWAP_COOLDOWN. The rescue arm is not
// held: a session on a blocked account is still evacuated.
describe('a woken row takes no affinity swap for SWAP_COOLDOWN (D-5242)', () => {
  const arrange = (wokeAgoS: number | null): void => {
    seed('claude'); pane('❯ '); live('claude', 'idle');
    fs.writeFileSync(regPath('lastswap'), String(nowS() - 5000));
    if (wokeAgoS !== null) fs.writeFileSync(regPath('woke'), String(nowS() - wokeAgoS));
  };

  it('a wake 60 s ago: the affinity arm dispatches nothing', () => {
    arrange(60);
    decide();
    expect(detached()).toEqual([]);
    expect(h.reg(ID, 'wrapper')).toBe('claude');
  });

  it('control: a wake older than SWAP_COOLDOWN dispatches as before', () => {
    arrange(5000);
    decide();
    expect(detached()).toHaveLength(1);
  });

  it('control: no .woke dispatches as before', () => {
    arrange(null);
    decide();
    expect(detached()).toHaveLength(1);
  });
});
