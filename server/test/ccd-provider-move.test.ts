// A session moves to a working lane after its third provider failure (the provider-failure ladder, wave 3b; plan
// docs/superpowers/plans/2026-11-25-provider-retry.md).
//
// The move is an automatic swap with an arm of its own, `provider`: decided from the session's own turn marker by the fleet limit
// watchdog's pass, and asked again at the act, where `_swap_rescue_act_gate` would cancel it as "no longer blocked". It ends the
// session and resumes it on another lane through `ccd swap`, and NO KEY IS EVER SENT.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). tmux answers one pane from `$HOME/pane.txt` and logs every call to `$HOME/ccd-calls`;
// the clock is ccd's own seam (`FAKE_NOW`). Neutral ids: `lane-a-project-a..d`, the fixture roster's wrappers.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ccdSource, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-provider-move-'); });
afterEach(() => { h.cleanup(); });
afterEach(() => { expect(h.calls().filter((l) => /send-keys|paste-buffer|load-buffer/.test(l)), 'a key was sent').toEqual([]); });

const ID = 'lane-a-project-a';
const PID = '4242';
const T0 = 1_900_000_000;
const MIN = 60;
const uuidOf = (id: string): string => `a0000000-0000-4000-8000-0000000000${id.charCodeAt(id.length - 1)}`.slice(0, 36);
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const put = (id: string, f: string, v: string): void => fs.writeFileSync(regFile(`${id}.${f}`), v);
const field = (id: string, f: string): string | null => h.reg(id, f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const mark = (lane: string, at = T0 - MIN): void => fs.writeFileSync(regFile(`${lane}-provfail`), `${at} server_error`);

interface Mark { state?: string; event?: string; sessionId?: string; turnAt?: number | null; stopAt?: number | null; err?: string | null; bg?: number; failAts?: readonly number[] }
/** The hook's line, in the hook's key order. Stamps are given in SECONDS and written in ms, as the hook writes them. */
const marker = (m: Mark, id = ID): void => {
  const ms = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : v * 1000);
  fs.writeFileSync(regFile(`${id}.turn.json`), `${JSON.stringify({
    v: 1, sessionId: m.sessionId ?? uuidOf(id), state: m.state ?? 'failed', event: m.event ?? 'StopFailure', at: T0 * 1000, turnAt: ms(m.turnAt), stopAt: ms(m.stopAt),
    bg: m.bg ?? 0, bgKinds: '', bgIds: '', err: m.err === undefined ? 'server_error' : m.err, restartAt: null, lostBg: 0, lostKinds: '', lostIds: '', crons: 0,
    failAts: (m.failAts ?? []).map((t) => t * 1000),
  })}\n`);
};
/** Counted failures this many seconds before `T0`, the newest owed. */
const failing = (...ago: number[]): Mark => ({ turnAt: T0 - Math.min(...ago) - 5, stopAt: T0 - Math.min(...ago), failAts: ago.map((a) => T0 - a) });
const THREE = failing(6 * MIN, 5 * MIN, MIN);

/** Claude Code's live status file for the stub pane's process (`_swap_idle_gate`'s reader). */
const processStatus = (status: 'idle' | 'busy' | 'shell' = 'idle', wrapper = 'claude', touchedAgo = 60): void => {
  const dir = h.sh(`_cfg_dir_to d ${wrapper}; echo "$d"`);
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sessions', `${PID}.json`), JSON.stringify({ status, statusUpdatedAt: (T0 - touchedAgo) * 1000 }));
};
const seed = (m: Mark | null = THREE, id = ID, wrapper = 'claude', home = 'claude'): void => {
  for (const [f, v] of [['uuid', uuidOf(id)], ['wrapper', wrapper], ['home', home], ['project', 'project-a'], ['started', '1']] as const) put(id, f, v);
  const wd = path.join(h.home, 'projects', `project-${id.slice(-1)}`);
  fs.mkdirSync(wd, { recursive: true });
  put(id, 'workdir', wd);
  if (m !== null) marker(m, id);
  processStatus('idle', wrapper);
};

const BORDER = '────────────────────────────';
const box = (typed = ''): string => `${BORDER}\n❯ ${typed}\n${BORDER}\n  ? for shortcuts`;
const FAILED_PANE = `  ⎿  API Error: 529 overloaded\n${box()}`;
const DRAFT_PANE = `  ⎿  API Error: 529 overloaded\n${box('a half-typed reply')}`;
const BUSY_PANE = `✻ Working… (12s · esc to interrupt)\n${box()}`;
const DIALOG_PANE = `${BORDER}\n  Which one?\n\n  ❯ 1. This\n    2. That\n\n  Enter to select · Esc to cancel`;

const STUBS = (pane: string): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) [[ -e "$HOME/narrow" ]] && { echo "1 80"; return 0; }; echo "1 200"; return 0 ;; esac
    case "\${1:-}" in
      capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo ${PID} ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; return 0; };
  launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; return 0; };
  sleep() { :; };`;
};
const ENV = (now = T0): Record<string, string> => ({ TMUX: '', TMUX_CREATED: String(now - 86400), FAKE_NOW: String(now) });

// ── the owed predicate ──────────────────────────────────────────────────────

describe('_provfail_owed: the third counted failure since the last move, still owed', () => {
  const owed = (lastswap = ''): string => h.sh(`_provfail_owed ${ID} ${T0} ${lastswap} && echo "$PF_LANE $PF_N $PF_FIRST $PF_LAST" || echo no`);

  it('three, with no turn since the newest: the lane, the count, the first and the newest', () => {
    seed(); expect(owed()).toBe(`claude 3 ${(T0 - 6 * MIN) * 1000} ${(T0 - MIN) * 1000}`);
    marker(failing(50 * MIN, 35 * MIN, 20 * MIN, 5 * MIN)); expect(owed()).toBe(`claude 4 ${(T0 - 50 * MIN) * 1000} ${(T0 - 5 * MIN) * 1000}`);
  });

  it.each<[string, Mark]>([
    ['two failures', failing(5 * MIN, MIN)],
    ['one of the three is over two hours old', failing(7201, 5 * MIN, MIN)],
    ['a turn newer than the newest failure: nothing is owed', { ...THREE, state: 'working', turnAt: T0 - 10 }],
    ['a good Stop emptied the list', { state: 'done', event: 'Stop', err: null, turnAt: T0 - 60, stopAt: T0 - 30, failAts: [] }],
    ['the failure the line ends on is `unknown`', { ...THREE, err: 'unknown' }],
    ['it ends on `max_output_tokens`', { ...THREE, err: 'max_output_tokens' }],
    ['it ends on a usage limit', { ...THREE, err: 'rate_limit' }],
    ['it has no word', { ...THREE, err: null }],
    ['another conversation\'s line', { ...THREE, sessionId: 'uuid-other' }],
  ])('%s: no', (_why, m) => { seed(m); expect(owed()).toBe('no'); });

  it('a restart that relabelled the line `done` and started no turn: still owed', () => {
    seed({ ...THREE, state: 'done', event: 'SessionStart' }); expect(owed()).toMatch(/^claude 3 /);
  });

  it('failures from before the last move were another lane\'s; the caller may name that move (the act gate\'s dispatch stamped it)', () => {
    seed(); put(ID, 'lastswap', String(T0 - 5 * MIN - 30)); expect(owed()).toBe('no');
    put(ID, 'lastswap', String(T0)); expect(owed()).toBe('no');
    expect(owed(String(T0 - 5000)), 'the lastswap the decision saw').toMatch(/^claude 3 /);
    expect(owed('0'), 'it saw none').toMatch(/^claude 3 /);
    expect(owed('soon'), 'no epoch').toBe('no');
  });
});

// ── what holds it ───────────────────────────────────────────────────────────

describe('_provider_hold_to: what a move waits for, at the decision and at the act', () => {
  const held = (pane: string, now = T0): string => h.sh(`${STUBS(pane)} _provfail_owed ${ID} ${now}; _provider_hold_to w ${ID} ${now} && echo "held $w" || echo "free[$w]"`, ENV(now));

  it('a failed turn at a quiet, empty prompt: nothing', () => { seed(); expect(held(FAILED_PANE)).toBe('free[]'); });
  it('a person\'s draft', () => { seed(); expect(held(DRAFT_PANE)).toBe('held draft'); });
  it.each(['placeholder-error-hint-cursor.ansi', 'placeholder-error-hint-unfocused.ansi'])('Claude Code\'s own "Resend your message" hint after a provider error is no draft (%s, captured)', (f) => {
    seed(); expect(held(fs.readFileSync(path.join(__dirname, 'fixtures/panes/box', f), 'utf8'))).toBe('free[]');
  });
  it('a draft below an empty first row', () => { seed(); expect(held(`${BORDER}\n❯ \n  second line\n${BORDER}\n  ? for shortcuts`)).toBe('held draft'); });
  it('a dialog or a question on screen', () => { seed(); expect(held(DIALOG_PANE)).toBe('held no-box'); });
  it('a running turn', () => { seed(); expect(held(BUSY_PANE)).toBe('held idle-gate'); });
  it('a live status that is not idle: a background shell, a question waiting', () => {
    seed(); processStatus('shell'); expect(held(FAILED_PANE)).toBe('held idle-gate');
    processStatus('busy'); expect(held(FAILED_PANE)).toBe('held idle-gate');
  });
  it('a touch in the last half minute', () => { seed(); processStatus('idle', 'claude', 10); expect(held(FAILED_PANE)).toBe('held idle-gate'); });
  it('a pane too narrow to tell', () => { seed(); fs.writeFileSync(path.join(h.home, 'narrow'), ''); expect(held(FAILED_PANE)).toBe('held idle-gate'); });

  it.each([1, 3, -1])('background work the last good Stop counted (bg %i), for 30 minutes from the first failure', (bg) => {
    seed({ ...THREE, bg });
    expect(held(FAILED_PANE)).toBe('held background');
    expect(held(FAILED_PANE, T0 - 6 * MIN + 30 * MIN - 1)).toBe('held background');
    expect(held(FAILED_PANE, T0 - 6 * MIN + 30 * MIN)).toBe('free[]');
  });
});

// ── the act ─────────────────────────────────────────────────────────────────

describe('_swap_provider_act_gate: the decision asked again after the jitter', () => {
  const FAIL = String((T0 - MIN) * 1000);
  const gate = (o: { pane?: string; extra?: string; env?: Record<string, string> } = {}): string =>
    h.sh(`${STUBS(o.pane ?? FAILED_PANE)} ${o.extra ?? ''} _swap_provider_act_gate ${ID} claude-a; echo "rc=$?"`,
      { ...ENV(), CCD_SWAP_PREV: '777', CCD_SWAP_DECIDED: String(T0), CCD_SWAP_FAIL: FAIL, ...o.env });
  const limits = (w: string, five: number): void => fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven: five, ts: T0 }));
  /** Cancelled: one line with its reason, `lastswap` put back to what the decision saw, nothing stopped. */
  const cancelled = (why: RegExp): void => {
    expect(lines('provider-cancel')).toEqual([expect.stringMatching(why)]);
    expect(field(ID, 'lastswap')).toBe('777');
    expect(h.calls().some((l) => /kill-session|stop|bootout/.test(l))).toBe(false);
  };
  beforeEach(() => { seed(); put(ID, 'lastswap', String(T0)); limits('claude-a', 10); });

  it('the same failure, newest and owed, at a quiet empty prompt: it proceeds and says nothing', () => {
    expect(gate()).toBe('rc=0'); expect(swapLog()).toBe(''); expect(field(ID, 'lastswap')).toBe(String(T0));
  });
  it('a decision that saw no lastswap: the cancel removes the one the dispatch stamped', () => {
    expect(gate({ pane: DRAFT_PANE, env: { CCD_SWAP_PREV: '' } })).toBe('rc=1'); expect(field(ID, 'lastswap')).toBeNull();
    put(ID, 'lastswap', String(T0)); expect(gate({ env: { CCD_SWAP_PREV: '' } })).toBe('rc=0');
  });
  it('a newer failure', () => { marker(failing(6 * MIN, 5 * MIN, MIN, 10)); expect(gate()).toBe('rc=1'); cancelled(/: its newest failure changed or is no longer owed$/); });
  it('a turn began', () => { marker({ ...THREE, state: 'working', turnAt: T0 - 5 }); expect(gate()).toBe('rc=1'); cancelled(/no longer owed$/); });
  it('a good Stop', () => { marker({ state: 'done', event: 'Stop', err: null, failAts: [], stopAt: T0 - 5 }); expect(gate()).toBe('rc=1'); cancelled(/no longer owed$/); });
  it('the marker is gone or cannot be read', () => {
    fs.rmSync(regFile(`${ID}.turn.json`)); expect(gate()).toBe('rc=1'); cancelled(/no longer owed$/);
  });
  it('a dispatch that names no failure proves none', () => { expect(gate({ env: { CCD_SWAP_FAIL: '' } })).toBe('rc=1'); cancelled(/no longer owed$/); });
  it('a move that landed during the jitter (the operator\'s own) is not undone, and its `lastswap` stays', () => {
    put(ID, 'wrapper', 'claude-b'); put(ID, 'lastswap', String(T0 + 20));
    expect(gate()).toBe('rc=1');
    expect(lines('provider-cancel')).toEqual([expect.stringMatching(/: it moved meanwhile$/)]);
    expect(field(ID, 'lastswap')).toBe(String(T0 + 20));
  });
  it('a `lastswap` that went, or a dispatch that names no decision, proves nothing either', () => {
    fs.rmSync(regFile(`${ID}.lastswap`)); expect(gate()).toBe('rc=1'); expect(gate({ env: { CCD_SWAP_DECIDED: '' } })).toBe('rc=1');
    expect(lines('provider-cancel')).toHaveLength(2); expect(field(ID, 'lastswap')).toBeNull();
  });
  it.each([['draft', DRAFT_PANE], ['no-box', DIALOG_PANE], ['idle-gate', BUSY_PANE]])('held: %s', (word, pane) => {
    expect(gate({ pane })).toBe('rc=1'); cancelled(new RegExp(`: ${word}$`));
  });
  it('background work', () => { marker({ ...THREE, bg: 2 }); expect(gate()).toBe('rc=1'); cancelled(/: background$/); });
  it('the target\'s provider began to fail', () => { mark('claude-a'); expect(gate()).toBe('rc=1'); cancelled(/: claude-a no longer takes it$/); });
  it('the target was switched off', () => { fs.writeFileSync(regFile('claude-a-disabled'), ''); expect(gate()).toBe('rc=1'); cancelled(/: claude-a no longer takes it$/); });
  it('the target reached its ceiling', () => { limits('claude-a', 99); expect(gate()).toBe('rc=1'); cancelled(/: claude-a no longer takes it$/); });
  it('a session the operator stopped is not revived', () => { put(ID, 'stopped', ''); expect(gate()).toBe('rc=1'); cancelled(/: stopped or asleep$/); });
  it('a hibernated one is not woken', () => { put(ID, 'hibernated', ''); expect(gate()).toBe('rc=1'); cancelled(/: stopped or asleep$/); });
  it.each(['gone', 'unknown'])('a probe that answers %s', (v) => {
    expect(gate({ extra: `_session_probe() { PROBE_VERDICT=${v}; PROBE_SUBSTRATE=present; };` })).toBe('rc=1'); cancelled(new RegExp(`: not live \\(${v}\\)$`));
  });
});

describe('cmd_swap under the provider arm', () => {
  /** The registry row, its transcript, and a notify.sh that logs. */
  const seedSwap = (): void => {
    seed(); put(ID, 'lastswap', String(T0));
    const dir = path.join(h.home, '.claude', 'projects', fs.realpathSync(h.reg(ID, 'workdir')!).replace(/[/._]/g, '-'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${uuidOf(ID)}.jsonl`), '{"type":"user","message":{"role":"user","content":"go on"}}\n');
    fs.writeFileSync(regFile('notify.sh'), '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
  };
  const swap = (arm = 'provider', pane = FAILED_PANE, extra = ''): string => h.sh(`${STUBS(pane)} cmd_ensure() { echo "cmd_ensure $*" >> "$HOME/ccd-calls"; return 0; };
    _svc_start() { return 0; }; ${extra} ( cmd_swap ${ID} claude-a ) 2>&1; echo "rc=$?"`,
    { ...ENV(), CCD_SWAP_AUTO: '1', CCD_SWAP_ARM: arm, CCD_SWAP_PREV: '777', CCD_SWAP_DECIDED: String(T0), CCD_SWAP_FAIL: String((T0 - MIN) * 1000) });
  const killed = (): boolean => h.calls().some((l) => /kill-session/.test(l));
  const notes = (): string => { const f = path.join(h.home, 'notify-log'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; };

  it('its own gate is asked, and a cancel ends nothing', () => {
    seedSwap();
    expect(swap('provider', DRAFT_PANE)).toBe('rc=0');
    expect(killed()).toBe(false); expect(field(ID, 'wrapper')).toBe('claude'); expect(field(ID, 'lastend')).toBeNull();
    expect(fs.existsSync(regFile(`${ID}.choicekept`))).toBe(false);
    expect(lines('provider-cancel')).toHaveLength(1);
  });

  it('it moves the session, and the limit rescue\'s gate would not have: no pane of a provider error reads as blocked', () => {
    seedSwap();
    expect(swap('rescue')).toBe('rc=0');
    expect(killed(), 'control: the rescue arm cancels it').toBe(false);
    expect(lines('rescue-cancel')).toHaveLength(1);
    put(ID, 'lastswap', String(T0));
    expect(swap()).toContain(`swapped ${ID}: claude -> claude-a`);
    expect(killed()).toBe(true); expect(field(ID, 'wrapper')).toBe('claude-a');
    expect(lines('swap').at(-1)).toMatch(new RegExp(` swap ${ID}: claude -> claude-a \\(uuid ${uuidOf(ID)}\\)$`));
  });

  it('the end is recorded as `swap-auto-provider`, and the operator is not pinged for each session', () => {
    seedSwap(); swap();
    expect(field(ID, 'lastend')).toMatch(/^\d+ swap-auto-provider$/);
    expect(lines('ended')).toEqual([expect.stringContaining(`ended ${ID}: swap-auto-provider`)]);
    expect(notes()).toBe('');
    expect(h.sh(`${STUBS(FAILED_PANE)} _resume_prompt_for ${ID}`, ENV(Number(field(ID, 'lastend')!.split(' ')[0])))).toContain('an automatic account swap off a lane whose provider answered with errors');
  });

  it('a swap of any other arm still pings', () => { seedSwap(); swap('wake'); expect(notes()).toContain(`${ID} moved claude -> claude-a`); });

  it('the marker is not touched by the move: same file, same conversation, the owed failures still on it', () => {
    seedSwap();
    const before = fs.readFileSync(regFile(`${ID}.turn.json`), 'utf8'), uuid = field(ID, 'uuid');
    swap();
    expect(fs.readFileSync(regFile(`${ID}.turn.json`), 'utf8')).toBe(before);
    expect(field(ID, 'uuid')).toBe(uuid);
    expect(JSON.parse(before)).toMatchObject({ sessionId: uuid, failAts: THREE.failAts!.map((t) => t * 1000) });
  });

  it('after it the failures were the old lane\'s: the moved session is not owed a second move', () => {
    seedSwap(); swap();
    expect(h.sh(`_provfail_owed ${ID} ${T0 + 60} && echo yes || echo no`)).toBe('no');
  });

  it('one function dispatches the arm, and `cmd_swap` sends it to its own gate', () => {
    const src = ccdSource().split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(src).toMatch(/provider\) +_swap_provider_act_gate "\$id" "\$target" \|\| return 0 ;;/);
    expect(src.match(/_dispatch_swap [^\n]* provider /g)).toHaveLength(1);
    const at = src.indexOf('\n_watchdog_provider() {');
    expect(src.slice(at, src.indexOf('\n}\n', at))).toMatch(/_dispatch_swap [^\n]* provider /);
  });

  it('the dispatch carries the failure it was decided for', () => {
    expect(h.sh(`_svc_run_detached() { printf '%s\\n' "$3"; }; SWAP_JITTER=0 _dispatch_swap ${ID} claude-a provider 777 ${T0} "" "" "" "" "" 1899999940000 2>/dev/null`)).toMatch(/CCD_SWAP_ARM=provider .*CCD_SWAP_FAIL=1899999940000 CCD_SWAP_AUTO=1 /);
  });
});

describe('the do-not-bounce and spread reads count a provider move as a rescue', () => {
  it('its lane is one the session just left, its target one another session was just sent to', () => {
    seed();
    const stamp = h.sh(`date '+%F %T'`);
    fs.writeFileSync(regFile('swap.log'), `${stamp} provider-rescue ${ID}: claude -> claude-a [home=claude] fails=3\n${stamp} swap ${ID}: claude -> claude-a (uuid u)\n`);
    expect(h.sh(`_rescue_history ${ID}; echo "$RESCUE_COUNT|$RESCUE_SKIP_LEFT|$RESCUE_SKIP_RECENT"`)).toBe('1|claude|claude-a');
    expect(h.sh(`_rescue_history other; echo "$RESCUE_COUNT|$RESCUE_SKIP_LEFT|$RESCUE_SKIP_RECENT"`)).toBe('0||claude-a');
  });
});

describe('_rescue_target keeps a skip list its caller set', () => {
  it('through every pass: the unskipped probe, the spread pass and the do-not-bounce pass', () => {
    seed();
    const limits = (w: string, five: number): void => fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven: five, ts: Math.floor(Date.now() / 1000) }));
    limits('claude', 99); limits('claude-a', 10); limits('claude-b', 20); limits('claude-d', 30);
    const go = (skip: string): string => h.sh(`SWAP_TARGET_SKIP="${skip}" _rescue_target ${ID} claude claude 1 0 || true`);
    expect(go('')).toBe('claude-a');
    expect(go('claude-a')).toBe('claude-b');
    const stamp = h.sh(`date '+%F %T'`);
    fs.writeFileSync(regFile('swap.log'), `${stamp} auto-rescue other: claude-d (blocked) -> claude-b [home=claude]\n`);
    expect(go('claude-a'), 'spread passes over claude-b, the caller\'s list over claude-a').toBe('claude-d');
    fs.writeFileSync(regFile('swap.log'), `${stamp} auto-rescue other: x (blocked) -> claude-b [home=claude]\n${stamp} auto-rescue other: x (blocked) -> claude-d [home=claude]\n`);
    expect(go('claude-a'), 'the pass after it').toBe('claude-b');
  });
});

// ── the decision: the watchdog's pass ───────────────────────────────────────

describe('the pass moves a session on its third provider failure', () => {
  const limits = (w: string, five: number, seven = five): void => fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven, ts: T0 }));
  /** Every Anthropic lane of the fixture roster with room; `gpt`, its Codex lane, off unless a test lets it in. */
  const fleet = (): void => { limits('claude', 20); limits('claude-a', 10); limits('claude-b', 30); limits('claude-d', 40); };
  const codex = (window: string, score = 5): void => {
    limits('gpt', score);
    fs.writeFileSync(path.join(h.home, '.local', 'bin', 'gpt'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const d = h.sh('_cfg_dir_to d gpt; echo "$d"');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_MAX_CONTEXT_TOKENS: window } }));
  };
  const context = (tokens: number | null, id = ID): void => {
    fs.mkdirSync(regFile('usage'), { recursive: true });
    fs.writeFileSync(regFile(`usage/${id}.json`), `{"ts":${T0 - 60},"uuid":"${uuidOf(id)}","account":"claude","ctxTokens":${tokens},"ctxWindow":1000000,"cost":1}\n`);
  };
  const pass = (o: { pane?: string; now?: number; extra?: string; env?: Record<string, string> } = {}): string =>
    h.sh(`${STUBS(o.pane ?? FAILED_PANE)} _dispatch_swap() { echo "dispatch $*" >> "$HOME/ccd-calls"; }; ${o.extra ?? ''} cmd_limit_watchdog`, { ...ENV(o.now ?? T0), ...o.env });
  const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
  const to = (): string[] => dispatches().map((d) => d.split(' ').slice(1, 4).join(' '));
  /** A session on `lane` whose last turn ended well there this many seconds before `T0`. */
  const goodOn = (lane: string, ago: number, id: string): void =>
    { for (const [f, v] of [['uuid', uuidOf(id)], ['wrapper', lane]] as const) put(id, f, v); marker({ state: 'done', event: 'Stop', err: null, turnAt: T0 - ago - 5, stopAt: T0 - ago }, id); };

  it('the third failure, owed: it goes to the least loaded lane, recorded as a rescue is, with the failure it was decided for', () => {
    seed(); fleet(); put(ID, 'lastswap', String(T0 - 5000));
    pass();
    expect(dispatches()).toEqual([`dispatch ${ID} claude-a provider ${T0 - 5000} ${T0}      ${(T0 - MIN) * 1000}`]);
    expect(lines('provider-rescue')).toEqual([expect.stringMatching(new RegExp(` provider-rescue ${ID}: claude -> claude-a \\[home=claude\\] fails=3$`))]);
    expect(field(ID, 'lastswap')).toBe(String(T0));
    expect(field(ID, 'stranded')).toBeNull(); expect(field(ID, 'limitwait')).toBeNull(); expect(field(ID, 'provwait')).toBeNull();
    expect(h.calls().some((l) => /kill-session/.test(l))).toBe(false);
  });

  it.each<[string, Mark]>([
    ['two failures', failing(5 * MIN, MIN)], ['a turn is running', { ...THREE, state: 'working', turnAt: T0 - 5 }],
    ['`unknown`', { ...THREE, err: 'unknown' }], ['`max_output_tokens`', { ...THREE, err: 'max_output_tokens' }],
  ])('%s: it stays, and nothing is written', (_why, m) => {
    seed(m); fleet(); pass(); expect(dispatches()).toEqual([]); expect(field(ID, 'provwait')).toBeNull(); expect(field(ID, 'lastswap')).toBeNull();
  });

  it('a session that moved is not moved again by the same failures, and its new lane needs three of its own', () => {
    seed(); fleet(); pass(); pass({ now: T0 + 1200 });
    expect(dispatches()).toHaveLength(1);
  });

  describe('the target', () => {
    it('a lane with a good Stop since the first failure comes before a less loaded one', () => {
      seed(); fleet(); goodOn('claude-d', 2 * MIN, 'x-d'); pass(); expect(to()).toEqual([`${ID} claude-d provider`]);
    });
    it('a good Stop from before the first failure proves nothing', () => {
      seed(); fleet(); goodOn('claude-d', 7 * MIN, 'x-d'); pass(); expect(to()).toEqual([`${ID} claude-a provider`]);
    });
    it('then another provider, when the session fits there, before an unproved lane of its own', () => {
      seed(); fleet(); codex('272000', 60); context(100_000); pass(); expect(to()).toEqual([`${ID} gpt provider`]);
    });
    it('a session too large for it, or of unmeasured size, takes the unproved lane instead', () => {
      seed(); fleet(); codex('272000'); context(400_000); pass(); expect(to()).toEqual([`${ID} claude-a provider`]);
    });
    it('a proved lane it does not fit is passed over too', () => {
      seed(); fleet(); codex('272000'); context(400_000); goodOn('gpt', MIN, 'x-g'); pass(); expect(to()).toEqual([`${ID} claude-a provider`]);
    });
    it('never a marked lane, and none of a provider with two marked lanes', () => {
      seed(); fleet(); mark('claude-a'); pass(); expect(to()).toEqual([]);
      // `claude` is marked by this very pass, so two Anthropic lanes are: the whole provider is failing.
      expect(field(ID, 'provwait')).toBe(String(T0));
      codex('272000'); context(100_000); pass({ now: T0 + MIN }); expect(to()).toEqual([`${ID} gpt provider`]);
    });
    it('the home it would return to is judged like any other lane', () => {
      seed(THREE, ID, 'claude-b', 'claude'); fleet(); mark('claude'); goodOn('claude-d', MIN, 'x-d');
      marker(THREE); pass(); expect(to()).toEqual([]);
      fs.rmSync(regFile('claude-provfail')); fs.rmSync(regFile(`${ID}.provwait`)); pass(); expect(to()).toEqual([`${ID} claude-d provider`]);
    });
    it('a home outside its pool list is still judged by its tier, so the home arm cannot take it out of order', () => {
      seed(THREE, ID, 'claude', 'claude-d'); fleet(); put(ID, 'pool', 'claude claude-b'); goodOn('claude-b', MIN, 'x-b');
      pass(); expect(to()).toEqual([`${ID} claude-b provider`]);
    });
    it('existing gates: switched off, at its ceiling, unmeasured', () => {
      seed(); fleet(); fs.writeFileSync(regFile('claude-a-disabled'), ''); pass(); expect(to()).toEqual([`${ID} claude-b provider`]);
    });
    it('at its ceiling', () => { seed(); fleet(); limits('claude-a', 99); pass(); expect(to()).toEqual([`${ID} claude-b provider`]); });
    it('never onto a lane whose room nobody measured', () => {
      seed(); limits('claude', 20); pass(); expect(to()).toEqual([]); expect(field(ID, 'provwait')).toBe(String(T0));
    });
    it('the pool: a set or a tag the lane is outside of', () => {
      seed(); fleet(); pass({ extra: '_pool_ok() { [[ "$1" == claude || "$1" == claude-b ]]; };' }); expect(to()).toEqual([`${ID} claude-b provider`]);
    });
    it('the class gate, as today: no lane that cannot serve it, and never one rung down', () => {
      seed(); fleet(); put(ID, 'class', 'opus');
      pass({ extra: '_serviceable() { [[ "$1" == claude-d ]]; };' }); expect(to()).toEqual([`${ID} claude-d provider`]);
      put(ID, 'lastswap', '0'); pass({ extra: '_serviceable() { [[ "$2" == sonnet ]]; };', now: T0 + 1 });
      expect(dispatches()).toHaveLength(1); expect(field(ID, 'degraded')).toBeNull(); expect(field(ID, 'provwait')).toBe(String(T0 + 1));
    });
    it('do not bounce: not a lane this session left inside the hour; and spread: one no other session was just sent to first', () => {
      seed(); fleet(); goodOn('claude-a', MIN, 'x-a'); goodOn('claude-b', MIN, 'x-b'); goodOn('claude-d', MIN, 'x-d');
      const at = h.sh(`command date -r ${T0 - 1200} '+%F %T' 2>/dev/null || command date -d @${T0 - 1200} '+%F %T'`), near = h.sh(`command date -r ${T0 - 60} '+%F %T' 2>/dev/null || command date -d @${T0 - 60} '+%F %T'`);
      fs.writeFileSync(regFile('swap.log'), `${at} provider-rescue ${ID}: claude-a -> claude [home=claude] fails=3\n${at} swap ${ID}: claude-a -> claude (uuid u)\n${near} provider-rescue other: x -> claude-b [home=x] fails=3\n`);
      pass(); expect(to()).toEqual([`${ID} claude-d provider`]);
    });
    it('nobody can say (the pool side cannot be read): no move, and no claim that there is no lane', () => {
      seed(); fleet(); pass({ extra: '_rescue_target() { return 4; };' }); expect(to()).toEqual([]); expect(field(ID, 'provwait')).toBeNull();
    });
  });

  describe('what it waits for', () => {
    it.each([['a draft', DRAFT_PANE], ['a dialog', DIALOG_PANE], ['a running turn', BUSY_PANE]])('%s: nothing is written, not even a wait', (_w, pane) => {
      seed(); fleet(); pass({ pane }); expect(dispatches()).toEqual([]); expect(field(ID, 'provwait')).toBeNull(); expect(field(ID, 'lastswap')).toBeNull();
    });
    it('background work', () => { seed({ ...THREE, bg: 1 }); fleet(); pass(); expect(dispatches()).toEqual([]); });
    it('the cooldown since its last move', () => {
      seed(failing(5 * MIN, 3 * MIN, MIN)); fleet(); put(ID, 'lastswap', String(T0 - 899)); pass(); expect(dispatches()).toEqual([]);
      put(ID, 'lastswap', String(T0 - 900)); pass(); expect(dispatches()).toHaveLength(1);
    });
    it('a swap the box just refused', () => {
      seed(); fleet(); put(ID, 'swapblocked', `${T0 - 1799} claude-a why`); pass(); expect(dispatches()).toEqual([]);
      put(ID, 'swapblocked', `${T0 - 1800} claude-a why`); pass(); expect(dispatches()).toHaveLength(1);
    });
    it.each(['stopped', 'hibernated'])('a row that is %s', (f) => { seed(); fleet(); put(ID, f, '1'); pass(); expect(dispatches()).toEqual([]); });
    it('a probe that does not say live', () => {
      seed(); fleet(); pass({ extra: '_session_probe() { PROBE_VERDICT=unknown; PROBE_SUBSTRATE=present; };' }); expect(dispatches()).toEqual([]);
    });
    it('a limit sign: that is the limit rescue\'s session, not this one\'s', () => {
      seed(); fleet(); pass({ pane: `  ⎿  You've hit your session limit · resets 9:10pm (UTC)\n${box()}` }); expect(dispatches()).toEqual([]); expect(field(ID, 'limitsign')).toBe(`${T0} banner`);
    });
    it('`CCRC_LIMIT_WATCHDOG_MIN=0` stops it', () => { seed(); fleet(); pass({ env: { CCRC_LIMIT_WATCHDOG_MIN: '0' } }); expect(dispatches()).toEqual([]); expect(field(ID, 'provwait')).toBeNull(); });
    it('a programme hold and a manual pin do not hold it: a limit rescue passes both', () => {
      seed(); fleet(); put(ID, 'hold', 'program:p wave:1'); put(ID, 'swappin', 'claude'); pass(); expect(dispatches()).toHaveLength(1);
    });
  });

  it('three moves leave one pass, forced limit rescues counted with them; the rest go in the next', () => {
    fleet();
    for (const n of ['a', 'b', 'c', 'd']) seed(THREE, `lane-a-project-${n}`);
    pass(); expect(dispatches()).toHaveLength(3);
    pass({ now: T0 + 1 }); expect(to().sort().map((t) => t.split(' ')[0])).toEqual(['a', 'b', 'c', 'd'].map((n) => `lane-a-project-${n}`));
  });

  it('a pass whose cap a limit rescue has used moves none', () => {
    seed(); fleet(); pass({ extra: 'WATCHDOG_PER_PASS=0;' }); expect(dispatches()).toEqual([]);
  });

  it('a dispatch that did not start puts `lastswap` back, so the failures still count and the next pass tries again', () => {
    seed(); fleet(); put(ID, 'lastswap', String(T0 - 5000));
    h.sh(`${STUBS(FAILED_PANE)} _svc_run_detached() { return 1; }; cmd_limit_watchdog`, ENV());
    expect(lines('dispatch')).toEqual(expect.arrayContaining([expect.stringContaining(`dispatch FAILED for ${ID} -> claude-a`)]));
    expect(field(ID, 'lastswap')).toBe(String(T0 - 5000));
    expect(fs.existsSync(regFile(`${ID}.dispatching`))).toBe(false);
    pass({ now: T0 + MIN }); expect(dispatches()).toHaveLength(1);
  });

  it('a dispatch already pending for the session is left alone', () => {
    seed(); fleet(); put(ID, 'dispatching', String(T0 - 5));
    h.sh(`${STUBS(FAILED_PANE)} _svc_run_detached() { echo "detached" >> "$HOME/ccd-calls"; return 0; }; cmd_limit_watchdog`, ENV());
    expect(h.calls()).not.toContain('detached'); expect(field(ID, 'lastswap')).toBeNull(); expect(lines('dispatch-dup')).toHaveLength(1);
  });

  describe('no lane: `.provwait`', () => {
    const none = (): void => { seed(); limits('claude', 20); };
    it('an epoch, written once and said once; never a strand and never a notice', () => {
      none(); fs.writeFileSync(regFile('notify.sh'), '#!/bin/sh\necho "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
      pass(); pass({ now: T0 + MIN }); pass({ now: T0 + 2 * MIN });
      expect(field(ID, 'provwait')).toBe(String(T0)); expect(lines('provider-wait')).toHaveLength(1);
      expect(field(ID, 'stranded')).toBeNull(); expect(field(ID, 'limitwait')).toBeNull(); expect(field(ID, 'lastswap')).toBeNull();
      expect(fs.existsSync(path.join(h.home, 'notify-log'))).toBe(false);
    });
    it('a malformed one is no record: it is written again', () => { none(); put(ID, 'provwait', 'soon'); pass(); expect(field(ID, 'provwait')).toBe(String(T0)); });
    it('a good Stop ends it', () => {
      none(); pass(); marker({ state: 'done', event: 'Stop', err: null, failAts: [], stopAt: T0 + 30, turnAt: T0 + 10 }); pass({ now: T0 + MIN }); expect(field(ID, 'provwait')).toBeNull();
    });
    it('a move ends it, whoever made it: the failures were the old lane\'s', () => {
      none(); pass(); put(ID, 'wrapper', 'claude-a'); put(ID, 'lastswap', String(T0 + 30)); pass({ now: T0 + MIN }); expect(field(ID, 'provwait')).toBeNull();
    });
    it('a running turn, and a marker that cannot be read, do not', () => {
      none(); pass(); marker({ ...THREE, state: 'working', turnAt: T0 + 10 }); pass({ now: T0 + MIN }); expect(field(ID, 'provwait')).toBe(String(T0));
      fs.rmSync(regFile(`${ID}.turn.json`)); pass({ now: T0 + 2 * MIN }); expect(field(ID, 'provwait')).toBe(String(T0));
    });
    it('a row that sleeps or is stopped waits for nothing', () => { none(); pass(); put(ID, 'stopped', ''); pass({ now: T0 + MIN }); expect(field(ID, 'provwait')).toBeNull(); });
    it('it goes with the row', () => { none(); pass(); h.sh(`_reg_purge ${ID}`); expect(field(ID, 'provwait')).toBeNull(); });
    it('one writer: the pass', () => {
      const src = ccdSource().split('\n').filter((l) => !/^\s*#/.test(l));
      expect(src.filter((l) => /_reg_set [^;]*provwait/.test(l))).toHaveLength(1);
    });
  });

  it('the pass records what the lanes of this fleet read as, for the decisions of the same pass only', () => {
    seed(); fleet(); goodOn('claude-d', MIN, 'x-d'); mark('gpt');
    expect(h.sh(`${STUBS(FAILED_PANE)} shopt -s nullglob; _provfail_pass ${T0}; echo "$PROVFAIL_MARKED|$PROVFAIL_GOODS"`, ENV()).split('\n').at(-1)).toBe(`claude gpt| claude-d=${(T0 - MIN) * 1000}`);
  });
});
