// The fleet limit watchdog on its own timer (D-8123, limit-swap-autofix Task 9; operator ruling 4).
//
// `ccd limit-watchdog` is one pass over every live session, run once a minute by `ccd-limit-watchdog.timer` and not by a
// supervisor tick. A session that shows a limit sign (the pane, the banner above the auto-opened menu, the menu, the
// transcript's newest real row, or its account at SWAP_CEILING in `~/.cc-limits`) for N minutes
// (`CCRC_LIMIT_WATCHDOG_MIN`, default 5) with no swap after the sign began is forced through the normal rescue path:
// past the cooldown, the draft and the stale-press holds, never past a running turn on an account-only sign. With no
// account that has MEASURED room it records `$REG/<id>.limitwait` (the Waiting on you item's source) and strands the
// session instead of moving it. Nothing here ever sends a key: the rescue ends the session and resumes it on another
// account, and the rate-limit menu ("What do you want to do?") is never typed into.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). tmux answers one pane from `$HOME/pane.txt` and logs every call to
// `$HOME/ccd-calls`; `_dispatch_swap` and `_svc_run_detached` log; the clock is ccd's own seam (`FAKE_NOW`), moved
// between passes. Neutral ids: the sessions `lane-a-project-a..d`, the fixture roster's wrappers.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, ccdSource, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-limit-watchdog-'); });
afterEach(() => { h.cleanup(); });
// Registered after the cleanup, so the stack order runs it first: the pin every ccd test file in this plan ends with.
afterEach(() => { expect(h.calls().filter((l) => /send-keys|paste-buffer/.test(l)), 'the watchdog sent a key').toEqual([]); });

const ID = 'lane-a-project-a';
const IDS = ['lane-a-project-a', 'lane-a-project-b', 'lane-a-project-c', 'lane-a-project-d'];
const UUID = 'a0000000-0000-4000-8000-0000000000f9';
const PID = '4242';
const T0 = 1_900_000_000;
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

const seed = (id = ID, wrapper = 'claude', home = 'claude'): void => {
  const n = id.slice(-1);
  h.sh(`_reg_set ${id} wrapper ${wrapper}
        _reg_set ${id} home ${home}
        _reg_set ${id} project project-${n}
        _reg_set ${id} workdir "$HOME/projects/project-${n}"
        _reg_set ${id} uuid ${UUID.slice(0, -1)}${n.charCodeAt(0) % 10}
        _reg_set ${id} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', `project-${n}`), { recursive: true });
};
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const field = (id: string, f: string): string | null => h.reg(id, f);
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const detached = (): string[] => h.calls().filter((l) => l.startsWith('detached '));

/** `~/.cc-limits/<w>.json`: `five`/`seven` percentages, a `ts` (default fresh), optional reset epochs. */
const limits = (w: string, five: number, seven: number, opts: { ts?: number; fiveResetAt?: number; sevenResetAt?: number } = {}): void => {
  fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five, seven, ts: T0, ...opts }));
};
/** The default fleet: the session's account full, one other account with measured room, the rest unmeasured. */
const fleet = (): void => { limits('claude', 100, 10, { fiveResetAt: T0 + 10000 }); limits('claude-a', 5, 5); };
/** Every measured account full; claude-d and gpt unmeasured (no file). */
const fullFleet = (): void => {
  limits('claude', 100, 10, { fiveResetAt: T0 + 10000 }); limits('claude-a', 100, 5); limits('claude-b', 99, 5);
};

const limitRow = (at: number): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  quotaLimits: { status: 'rejected', resetsAt: at + 9000, rateLimitType: 'five_hour' },
});
const turn = (at: number): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] },
});
const writeTranscript = (lines_: string[], id = ID): string => {
  const p = h.sh(`_transcript_path ${id}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines_.join('\n') + '\n');
  return p;
};

/** The hook's turn marker at a Stop (`at`/`stopAt` in ms): `done` with `bg` background tasks, last Stop at second `atS`. */
const bgMarker = (bg: number, atS: number, kinds = 'subagent', id = ID): void => {
  const uuid = `${UUID.slice(0, -1)}${id.slice(-1).charCodeAt(0) % 10}`;
  fs.writeFileSync(regFile(`${id}.turn.json`), `{"v":1,"sessionId":"${uuid}","state":"done","at":${atS * 1000},"stopAt":${atS * 1000},"bg":${bg},"bgKinds":"${kinds}"}\n`);
};

/** Claude Code's live status file for the stub pane's process (`_swap_idle_gate`'s reader): `idle`, last touched an hour ago. */
const processStatus = (status: 'idle' | 'busy' = 'idle', wrapper = 'claude', touchedAgo = 3600): void => {
  const dir = h.sh(`_cfg_dir_to d ${wrapper}; echo "$d"`);
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sessions', `${PID}.json`), JSON.stringify({ status, statusUpdatedAt: (T0 - touchedAgo) * 1000 }));
};

const BORDER = '────────────────────────────';
const PROMPT = `${BORDER}\n❯ \n${BORDER}\n  ? for shortcuts`;
const BANNER_LINE = "  ⎿  You've hit your session limit · resets 9:10pm (UTC)";
const BANNER = `${BANNER_LINE}\n${PROMPT}`;
const BANNER_WITH_DRAFT = `${BANNER_LINE}\n${BORDER}\n❯ a half-typed reply\n${BORDER}\n  ? for shortcuts`;
const BUSY = `✻ Working… (12s · esc to interrupt)\n${PROMPT}`;
const MENU = [
  BANNER_LINE, '', BORDER, '  What do you want to do?', '',
  '  ❯ 1. Stop and wait for limit to reset', '    2. Upgrade your plan', '    3. Switch to usage credits', '',
  '  Enter to confirm · Esc to cancel',
].join('\n');

/** tmux answers ONE pane for every capture; `narrow` in HOME makes the width query answer 80. */
const STUBS = (pane: string): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) [[ -e "$HOME/narrow" ]] && { echo "1 80"; return 0; }; echo "1 200"; return 0 ;; esac
    case "\${1:-}" in
      capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo ${PID} ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2 $3" >> "$HOME/ccd-calls"; };
  _svc_run_detached() { echo "detached $*" >> "$HOME/ccd-calls"; return 0; };`;
};
/** One watchdog pass at fixture second `now`; `born` is when the pane's process started (a day before, by default). */
const pass = (pane: string, now: number, extra = '', envx: Record<string, string> = {}, born = now - 86400): string =>
  h.sh(`${STUBS(pane)} ${extra} cmd_limit_watchdog`, { TMUX_CREATED: String(born), FAKE_NOW: String(now), ...envx });

describe('the banner rung: five minutes with no swap forces the rescue', () => {
  it('a banner for 5 minutes with no swap: watchdog-rescue past the cooldown and a draft', () => {
    seed(); fleet(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);   // inside SWAP_COOLDOWN, older than the sign
    pass(BANNER_WITH_DRAFT, T0);                                    // first sight: stamps limitsign, no act
    expect(field(ID, 'limitsign')).toBe(`${T0} banner`);
    expect(dispatches()).toEqual([]);
    pass(BANNER_WITH_DRAFT, T0 + 299);
    expect(dispatches()).toEqual([]);
    pass(BANNER_WITH_DRAFT, T0 + 300);
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/watchdog-rescue lane-a-project-a: claude -> claude-a \[home=claude\] sign=banner for=300s$/)]);
    expect(dispatches()).toEqual([expect.stringMatching(/^dispatch lane-a-project-a -> claude-a watchdog$/)]);
    expect(field(ID, 'lastswap')).toBe(String(T0 + 300));
  });

  it('the dispatch carries the decision: prev lastswap, the decision epoch and the transcript', () => {
    seed(); fleet(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    const tx = writeTranscript([turn(T0 - 600)]);
    pass(BANNER, T0); pass(BANNER, T0 + 300, '_dispatch_swap() { echo "dispatch $*" >> "$HOME/ccd-calls"; };');
    const bytes = fs.statSync(tx).size;
    expect(dispatches()).toEqual([`dispatch ${ID} claude-a watchdog ${T0 - 100} ${T0 + 300}   ${tx} ${bytes}`]);
  });

  it('the sign clears between passes: the clock restarts', () => {
    seed(); fleet();
    pass(BANNER, T0);
    pass(PROMPT, T0 + 120);   // the banner is gone, but the account still reads 100 on a fresh reading: the account rung holds
    expect(field(ID, 'limitsign')).toBe(`${T0} account`);   // a different sign keeps the episode's `since`
    limits('claude', 10, 10);                         // the account recovered too
    pass(PROMPT, T0 + 180);
    expect(field(ID, 'limitsign')).toBeNull();
    fleet();
    pass(BANNER, T0 + 290);                           // a new episode starts at T0 + 290
    expect(field(ID, 'limitsign')).toBe(`${T0 + 290} banner`);
    pass(BANNER, T0 + 300);
    expect(dispatches()).toEqual([]);                 // 10 s into the new episode, 300 s after the first sight
  });

  it('a swap after the sign began: no act until the sign has outlived that swap by N minutes', () => {
    seed(); fleet();
    pass(BANNER, T0);
    h.sh(`_reg_set ${ID} lastswap ${T0 + 100}`);
    pass(BANNER, T0 + 399);                           // 299 s after the swap: the normal path is still given its time
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-rescue')).toEqual([]);
    pass(BANNER, T0 + 400);                           // a full N minutes after the swap and still on a limit
    expect(lines('watchdog-rescue')).toHaveLength(1);
    expect(dispatches()).toHaveLength(1);
  });

  it('the watchdog\'s own move restarts the clock: a landing still on a limit is forced again N minutes later', () => {
    seed(); fleet();
    pass(BANNER, T0);
    pass(BANNER, T0 + 300);                           // the first forced move; lastswap = T0 + 300
    expect(dispatches()).toHaveLength(1);
    expect(field(ID, 'lastswap')).toBe(String(T0 + 300));
    pass(BANNER, T0 + 360);                           // the sign never cleared (the landing hit a limit at once)
    pass(BANNER, T0 + 599);
    expect(dispatches()).toHaveLength(1);             // inside N minutes of its own move: quiet
    pass(BANNER, T0 + 600);
    expect(lines('watchdog-rescue')).toHaveLength(2);
    expect(dispatches()).toHaveLength(2);
    expect(field(ID, 'lastswap')).toBe(String(T0 + 600));
  });

  it('a move whose dispatch failed after the stamp is retried N minutes after it, not never', () => {
    seed(); fleet();
    pass(BANNER, T0);
    pass(BANNER, T0 + 300, '_dispatch_swap() { echo "dispatch $1 -> $2 $3 (failed)" >> "$HOME/ccd-calls"; return 1; };');
    expect(field(ID, 'lastswap')).toBe(String(T0 + 300));   // left stamped by the failure
    pass(BANNER, T0 + 599);
    expect(dispatches()).toHaveLength(1);
    pass(BANNER, T0 + 600);
    expect(dispatches()).toHaveLength(2);
  });

  it('no lastswap at all is no hold either', () => {
    seed(); fleet();
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(dispatches()).toHaveLength(1);
  });

  it('a non-numeric lastswap is read past, never evaluated', () => {
    seed(); fleet(); h.sh(`_reg_set ${ID} lastswap 'REG[$(touch "$HOME/PWNED")]'`);
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(fs.existsSync(path.join(h.home, 'PWNED'))).toBe(false);
    expect(dispatches()).toHaveLength(1);
  });
});

describe('the other rungs', () => {
  it('the menu rung: the menu on screen is a sign', () => {
    seed(); fleet();
    pass(MENU, T0);
    expect(field(ID, 'limitsign')).toMatch(/^1900000000 (banner|menu)$/);   // the banner above the menu is on the whole-pane read
    pass(MENU, T0 + 300);
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=(banner|menu) for=300s$/)]);
  });

  it('the menu with its banner scrolled out is the menu rung, still forced after N minutes', () => {
    seed(); fleet();
    const menuOnly = MENU.split('\n').slice(2).join('\n');
    pass(menuOnly, T0); pass(menuOnly, T0 + 300);
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=menu for=300s$/)]);
  });

  it('the transcript rung: the newest real row is this process\'s limit row, and .tscan is never written', () => {
    seed(); fleet();
    writeTranscript([turn(T0 - 600), limitRow(T0 - 30)]);
    pass(PROMPT, T0); pass(PROMPT, T0 + 300, '', {}, T0 - 3600);
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=transcript for=300s$/)]);
    expect(field(ID, 'tscan')).toBeNull();
  });

  it('a narrow pane still gets the transcript rung, and its pane text is never read', () => {
    seed(); fleet(); fs.writeFileSync(path.join(h.home, 'narrow'), '');
    writeTranscript([turn(T0 - 600), limitRow(T0 - 30)]);
    pass(BANNER, T0, '', {}, T0 - 3600); pass(BANNER, T0 + 300, '', {}, T0 - 3600);
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=transcript for=300s$/)]);
    expect(h.calls().filter((l) => l.startsWith('tmux capture-pane'))).toEqual([]);
  });

  it('a banner carried in by a swap (a row older than the process and the last swap) is no sign', () => {
    seed(); limits('claude', 20, 20); limits('claude-a', 5, 5);
    h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    pass(BANNER, T0, '', {}, T0 - 1900); pass(BANNER, T0 + 600, '', {}, T0 - 1900);
    expect(field(ID, 'limitsign')).toBeNull();
    expect(dispatches()).toEqual([]);
  });

  it('the account rung: five or seven at SWAP_CEILING on a fresh reading, with an ordinary prompt', () => {
    seed(); limits('claude', 10, 98); limits('claude-a', 5, 5); processStatus();
    pass(PROMPT, T0); pass(PROMPT, T0 + 300);
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=account for=300s$/)]);
  });

  it('an account reading 99 older than SWAP_FRESH is no sign', () => {
    seed(); limits('claude', 99, 10, { ts: T0 - 2000 }); limits('claude-a', 5, 5);
    pass(PROMPT, T0); pass(PROMPT, T0 + 600);
    expect(field(ID, 'limitsign')).toBeNull();
    expect(dispatches()).toEqual([]);
  });

  it('an account reading at the ceiling whose window already reset is no sign', () => {
    seed(); limits('claude', 10, 100, { sevenResetAt: T0 - 60 }); limits('claude-a', 5, 5);
    pass(PROMPT, T0);
    expect(field(ID, 'limitsign')).toBeNull();
  });
});

describe('an account-only sign does not age a block (operator review)', () => {
  it('account for 10 minutes, then a banner on a draft: the clock restarts at the banner, not at the account sign', () => {
    seed(); fleet();
    pass(BUSY, T0); pass(BUSY, T0 + 600);                    // a long turn on an account that reads 100: held running
    expect(field(ID, 'limitsign')).toBe(`${T0} account held`);
    pass(BANNER_WITH_DRAFT, T0 + 610);                       // the turn ended on the limit banner; the operator is typing
    expect(field(ID, 'limitsign')).toBe(`${T0 + 610} banner`);   // new episode: since and the flags restart
    expect(dispatches()).toEqual([]);
    pass(BANNER_WITH_DRAFT, T0 + 909);
    expect(dispatches()).toEqual([]);
    pass(BANNER_WITH_DRAFT, T0 + 910);                       // N minutes of being blocked: the draft is overridden (ruled)
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=banner for=300s$/)]);
    expect(dispatches()).toHaveLength(1);
  });

  it('the other direction keeps the episode: a banner that falls back to the account sign keeps its since', () => {
    seed(); fleet();
    pass(BANNER, T0); pass(PROMPT, T0 + 120);
    expect(field(ID, 'limitsign')).toBe(`${T0} account`);
  });
});

describe('an account-only sign leaves the operator\'s hold and pin alone', () => {
  const idle = (): void => { processStatus(); };

  it('a hold file: watchdog-hold once, no dispatch, however long the account reads high', () => {
    seed(); limits('claude', 10, 98); limits('claude-a', 5, 5); idle();
    fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:2/5\n');
    pass(PROMPT, T0); pass(PROMPT, T0 + 300); pass(PROMPT, T0 + 600);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/watchdog-hold lane-a-project-a: the session is held \(hold\)/)]);
    expect(lines('watchdog-rescue')).toEqual([]);
  });

  it('a manual-swap pin to this account: no dispatch (the pin stands at the ceiling when its expiry brake is on)', () => {
    seed(); limits('claude', 10, 98); limits('claude-a', 5, 5); idle();
    fs.writeFileSync(regFile('swap-pin-expiry-off'), '');
    h.sh(`_reg_set ${ID} swappin claude`);
    pass(PROMPT, T0); pass(PROMPT, T0 + 300);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/pinned to claude by hand/)]);
  });

  it('a pin to another account does not hold it', () => {
    seed(); limits('claude', 10, 98); limits('claude-a', 5, 5); idle();
    h.sh(`_reg_set ${ID} swappin claude-b`);
    pass(PROMPT, T0); pass(PROMPT, T0 + 300);
    expect(dispatches()).toHaveLength(1);
  });

  it('a banner sign passes a hold file, as ruled', () => {
    seed(); fleet();
    fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:2/5\n');
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(dispatches()).toHaveLength(1);
  });

  it('the act gate backs off an account-only sign when a hold appeared during the jitter, and puts lastswap back', () => {
    seed(); limits('claude', 10, 98); processStatus(); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:2/5\n');
    expect(gateAt(PROMPT, { CCD_SWAP_PREV: '777' })).toBe('rc=1');
    expect(lines('rescue-backoff')).toEqual([expect.stringMatching(/rescue-backoff lane-a-project-a: the session is held \(hold\)$/)]);
    expect(field(ID, 'lastswap')).toBe('777');
  });

  it('the act gate backs off an account-only sign on a pin; a banner sign proceeds past a hold', () => {
    seed(); limits('claude', 10, 98); processStatus();
    fs.writeFileSync(regFile('swap-pin-expiry-off'), '');
    h.sh(`_reg_set ${ID} swappin claude`);
    expect(gateAt(PROMPT)).toBe('rc=1');
    expect(lines('rescue-backoff')).toEqual([expect.stringMatching(/pinned to claude by hand \(swappin\)$/)]);
    fs.rmSync(regFile('swap.log'));
    h.sh(`_reg_del ${ID} swappin 2>/dev/null || rm -f "$REG/${ID}.swappin"`);
    fleet(); fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:2/5\n');
    expect(gateAt(BANNER)).toBe('rc=0');
  });
});

const gateAt = (pane: string, envx: Record<string, string> = {}): string =>
  h.sh(`${STUBS(pane)} _swap_watchdog_act_gate ${ID} claude; echo "rc=$?"`, { TMUX_CREATED: String(T0 - 86400), FAKE_NOW: String(T0), ...envx });

describe('the account-only sign waits for a running turn', () => {
  it('mid-turn: watchdog-hold running once, no dispatch; idle next pass: it acts', () => {
    seed(); limits('claude', 10, 99); limits('claude-a', 5, 5);
    pass(BUSY, T0); pass(BUSY, T0 + 300); pass(BUSY, T0 + 360);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/watchdog-hold lane-a-project-a: running: a turn or background work/)]);
    processStatus();
    pass(PROMPT, T0 + 420);
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/sign=account for=420s$/)]);
    expect(dispatches()).toHaveLength(1);
  });

  it('a pane sign is never held for a running turn (a banner cannot be mid-turn)', () => {
    seed(); fleet();
    const both = `${BUSY}\n${BANNER_LINE}`;
    pass(both, T0); pass(both, T0 + 300);
    expect(lines('watchdog-rescue')).toHaveLength(1);
  });

  it('an idle prompt with a subagent or background shell running holds an account-only sign (the idle gate reads the turn marker)', () => {
    seed(); limits('claude', 10, 99); limits('claude-a', 5, 5); processStatus();
    // The hook's line at the last Stop: `done` with two background tasks, a Stop a minute before the pass.
    bgMarker(2, T0 - 60, 'subagent,shell');
    pass(PROMPT, T0); pass(PROMPT, T0 + 300); pass(PROMPT, T0 + 600);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/watchdog-hold lane-a-project-a: running: a turn or background work/)]);
    bgMarker(0, T0 + 650, '');
    pass(PROMPT, T0 + 660);
    expect(lines('watchdog-rescue')).toHaveLength(1);
  });

  it('a pane too narrow to read for the running marker holds an account-only sign', () => {
    seed(); limits('claude', 10, 99); limits('claude-a', 5, 5); fs.writeFileSync(path.join(h.home, 'narrow'), '');
    pass(PROMPT, T0); pass(PROMPT, T0 + 300);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/watchdog-hold lane-a-project-a: .*pane/)]);
  });
});

describe('no account has measured room', () => {
  it('watchdog-noroom once, a strand, a limitwait record, no dispatch', () => {
    seed(); fullFleet();
    pass(BANNER, T0); pass(BANNER, T0 + 300); pass(BANNER, T0 + 360);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-noroom')).toEqual([expect.stringMatching(/watchdog-noroom lane-a-project-a: claude sign=banner for=5m and no account has measured room$/)]);
    expect(field(ID, 'stranded')).toMatch(/limit sign banner for 5 min and no account has measured room/);
    expect(field(ID, 'limitwait')).toBe(`state=open since=${T0 + 300} reset=${T0 + 10000} account=claude sign=banner choice=wait at=${T0 + 300} by=auto`);
  });

  it('an unmeasured account is never room (claude-d and gpt have no telemetry)', () => {
    seed(); limits('claude', 100, 10); limits('claude-a', 100, 100); limits('claude-b', 100, 100);
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-noroom')).toHaveLength(1);
  });

  it('room appears later: the next pass dispatches, with the record still open for the landing to close', () => {
    seed(); fullFleet();
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(dispatches()).toEqual([]);
    limits('claude-b', 20, 20);
    pass(BANNER, T0 + 360);
    expect(dispatches()).toEqual([expect.stringMatching(/ -> claude-b watchdog$/)]);
  });

  it('the account-only sign records the wait but does not strand a session that is not blocked', () => {
    seed(); limits('claude', 99, 10); limits('claude-a', 100, 100); limits('claude-b', 100, 100); processStatus();
    pass(PROMPT, T0); pass(PROMPT, T0 + 300);
    expect(field(ID, 'limitwait')).toMatch(/^state=open since=1900000300 reset=- account=claude sign=account$/);
    expect(field(ID, 'stranded')).toBeNull();
  });

  it('a sign that clears closes the record', () => {
    seed(); fullFleet();
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    limits('claude', 10, 10);
    pass(PROMPT, T0 + 360);
    expect(field(ID, 'limitwait')).toMatch(/^state=closed since=1900000300 reset=\d+ account=claude sign=banner choice=wait at=1900000300 by=auto end=clear until=1900000360$/);
    expect(field(ID, 'limitsign')).toBeNull();
  });

  it('an undecidable target answer (the pool rule) is said once and moves nothing', () => {
    seed(); fleet();
    pass(BANNER, T0);
    pass(BANNER, T0 + 300, '_rescue_target() { return 4; };'); pass(BANNER, T0 + 360, '_rescue_target() { return 4; };');
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-undecidable')).toEqual([expect.stringMatching(/watchdog-undecidable lane-a-project-a: rc4$/)]);
    expect(field(ID, 'limitwait')).toBeNull();
  });

  it('an undecidable class window drops the class gate, as the supervisor tick does', () => {
    seed(); fleet();
    pass(BANNER, T0);
    pass(BANNER, T0 + 300, '_rescue_target() { if [[ "${CCD_CLASS_GATE_OFF:-}" == 1 ]]; then echo claude-a; return 0; fi; return 5; };');
    expect(lines('class-gate-dropped')).toHaveLength(1);
    expect(dispatches()).toEqual([expect.stringMatching(/ -> claude-a watchdog$/)]);
  });

  it('the dropped gate keeps the usage-credits guard: a fable session is moved with the degrade to opus, any other class with none', () => {
    const stubs = (cls: string): string => `_route_peek_to() { printf -v "$1" ''; [[ "$3" == class ]] && printf -v "$1" ${cls}; return 0; };
      _rescue_target() { if [[ "\${CCD_CLASS_GATE_OFF:-}" == 1 ]]; then echo claude-a; return 0; fi; return 5; };
      _dispatch_swap() { echo "dispatch $1 $2 $3 dfrom=$6 dto=$7" >> "$HOME/ccd-calls"; };`;
    seed(); fleet();
    pass(BANNER, T0);
    pass(BANNER, T0 + 300, stubs('fable'));
    expect(lines('class-gate-dropped')).toHaveLength(1);
    expect(dispatches()).toEqual([`dispatch ${ID} claude-a watchdog dfrom=fable dto=opus`]);
    seed(IDS[1]); h.sh(`_reg_set ${IDS[1]} wrapper claude`);
    pass(BANNER, T0 + 400, stubs('opus'));
    pass(BANNER, T0 + 700, stubs('opus'));
    expect(dispatches().filter((l) => l.includes(IDS[1]))).toEqual([`dispatch ${IDS[1]} claude-a watchdog dfrom= dto=`]);
  });
});

describe('the holds the rulings do not name stay', () => {
  it('a refused swap (swapblocked) holds the watchdog, said once', () => {
    seed(); fleet(); h.sh(`_reg_set ${ID} swapblocked "${T0 + 100} refused"`);
    pass(BANNER, T0); pass(BANNER, T0 + 300); pass(BANNER, T0 + 360);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/watchdog-hold lane-a-project-a: .*swapblocked/)]);
  });

  it('an open chain wait on the same account holds it; a no-room wait does not', () => {
    seed(); fleet();
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=${T0} reset=- wrapper=claude"`);
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/rescue wait \(chain\)/)]);
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=noroom since=${T0} reset=- wrapper=claude"`);
    pass(BANNER, T0 + 360);
    expect(dispatches()).toHaveLength(1);
  });

  it('a hibernated or stopped session is skipped and reads no pane', () => {
    seed(); fleet(); fs.writeFileSync(regFile(`${ID}.hibernated`), '');
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(h.calls().filter((l) => l.startsWith('tmux capture-pane'))).toEqual([]);
    fs.rmSync(regFile(`${ID}.hibernated`)); fs.writeFileSync(regFile(`${ID}.stopped`), '');
    pass(BANNER, T0 + 360);
    expect(h.calls().filter((l) => l.startsWith('tmux capture-pane'))).toEqual([]);
    expect(dispatches()).toEqual([]);
  });

  it('a session positively gone has its records cleared; an unanswered probe leaves them', () => {
    seed(); fleet();
    pass(BANNER, T0);
    pass(BANNER, T0 + 60, '_session_probe() { PROBE_VERDICT=unknown; PROBE_DETAIL=x; PROBE_SUBSTRATE=unmeasured; };');
    expect(field(ID, 'limitsign')).toBe(`${T0} banner`);
    pass(BANNER, T0 + 120, '_session_probe() { PROBE_VERDICT=gone; PROBE_DETAIL=""; PROBE_SUBSTRATE=present; };');
    expect(field(ID, 'limitsign')).toBeNull();
  });
});

describe('the pass', () => {
  const four = (): void => { for (const id of IDS) seed(id); fleet(); };

  it('four sessions due in one pass: three dispatched, the fourth next pass', () => {
    four();
    pass(BANNER, T0);
    pass(BANNER, T0 + 300);
    expect(dispatches()).toHaveLength(3);
    expect(lines('watchdog-rescue')).toHaveLength(3);
    pass(BANNER, T0 + 360);
    expect(dispatches()).toHaveLength(4);
    expect(new Set(dispatches().map((l) => l.split(' ')[1])).size).toBe(4);
  });

  it('CCRC_LIMIT_WATCHDOG_MIN=0: nothing is read or written', () => {
    seed(); fleet();
    pass(BANNER, T0, '', { CCRC_LIMIT_WATCHDOG_MIN: '0' }); pass(BANNER, T0 + 3000, '', { CCRC_LIMIT_WATCHDOG_MIN: '0' });
    expect(h.calls()).toEqual([]);
    expect(field(ID, 'limitsign')).toBeNull();
    expect(swapLog()).toBe('');
  });

  it('CCRC_LIMIT_WATCHDOG_MIN=2 moves the threshold', () => {
    seed(); fleet();
    pass(BANNER, T0, '', { CCRC_LIMIT_WATCHDOG_MIN: '2' }); pass(BANNER, T0 + 119, '', { CCRC_LIMIT_WATCHDOG_MIN: '2' });
    expect(dispatches()).toEqual([]);
    pass(BANNER, T0 + 120, '', { CCRC_LIMIT_WATCHDOG_MIN: '2' });
    expect(lines('watchdog-rescue')).toEqual([expect.stringMatching(/for=120s$/)]);
  });

  it('a pass that has used its time budget stops and says so', () => {
    four();
    pass(BANNER, T0, 'WATCHDOG_BUDGET_S=0;');
    expect(h.calls().filter((l) => l.startsWith('tmux capture-pane'))).toEqual([]);
    expect(swapLog().split('\n').filter((l) => / watchdog-budget: the pass used its 0s and stopped before lane-a-project-/.test(l))).toHaveLength(1);
  });

  it('an unreadable registry is the one failure: rc 1 and a word on stderr', () => {
    const out = h.sh('REG=/nonexistent/reg; cmd_limit_watchdog 2>&1; echo "rc=$?"');
    expect(out).toMatch(/limit-watchdog: the registry \/nonexistent\/reg is unreadable[\s\S]*rc=1$/);
  });

  it('it takes no arguments', () => {
    expect(h.sh('( cmd_limit_watchdog now ) 2>&1; echo "rc=$?"')).toMatch(/usage: ccd limit-watchdog[\s\S]*rc=[1-9]/);
  });

  it('the dispatcher reaches it, and it is a verb of cmd_caps', () => {
    expect(h.sh('cmd_caps')).toMatch(/^limit-watchdog$/m);
  });
});

describe('the act gate (cmd_swap\'s watchdog arm)', () => {
  const gate = (pane: string, extra = '', envx: Record<string, string> = {}): string =>
    h.sh(`${STUBS(pane)} ${extra} _swap_watchdog_act_gate ${ID} claude; echo "rc=$?"`, { TMUX_CREATED: String(T0 - 86400), FAKE_NOW: String(T0), ...envx });

  it('sign gone: watchdog-cancel, lastswap put back', () => {
    seed(); limits('claude', 20, 20); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    expect(gate(PROMPT, '', { CCD_SWAP_PREV: '777' })).toBe('rc=1');
    expect(lines('watchdog-cancel')).toEqual([expect.stringMatching(/watchdog-cancel lane-a-project-a: no limit sign$/)]);
    expect(field(ID, 'lastswap')).toBe('777');
  });

  it('a draft on a banner pane proceeds (ruled)', () => {
    seed(); fleet();
    expect(gate(BANNER_WITH_DRAFT)).toBe('rc=0');
    expect(swapLog()).toBe('');
  });

  it('output since the decision backs off, and undoes the lastswap', () => {
    seed(); fleet(); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    const tx = writeTranscript([turn(T0 - 600)]);
    const bytes = fs.statSync(tx).size;
    fs.appendFileSync(tx, turn(T0 - 5) + '\n');
    expect(gate(BANNER, '', { CCD_SWAP_TX: tx, CCD_SWAP_TX_BYTES: String(bytes), CCD_SWAP_PREV: '' })).toBe('rc=1');
    expect(lines('rescue-backoff')).toEqual([expect.stringMatching(/rescue-backoff lane-a-project-a: output since decision$/)]);
    expect(field(ID, 'lastswap')).toBeNull();
  });

  it('an account-only sign with a turn running at the act backs off', () => {
    seed(); limits('claude', 10, 99);
    expect(gate(BUSY)).toBe('rc=1');
    expect(lines('rescue-backoff')).toEqual([expect.stringMatching(/rescue-backoff lane-a-project-a: a turn or background work is running$/)]);
  });

  it('an account-only sign at an idle prompt with background work running backs off too (the idle gate, not the pane alone)', () => {
    seed(); limits('claude', 10, 99); processStatus();
    bgMarker(1, T0 - 60, 'shell');
    expect(gate(PROMPT)).toBe('rc=1');
    expect(lines('rescue-backoff')).toEqual([expect.stringMatching(/rescue-backoff lane-a-project-a: a turn or background work is running$/)]);
  });

  it('an account-only sign at a clean idle prompt proceeds', () => {
    seed(); limits('claude', 10, 99); processStatus();
    expect(gate(PROMPT)).toBe('rc=0');
  });

  it('a pane sign proceeds without the process status file (a session that has stopped is held by nothing)', () => {
    seed(); fleet();
    expect(gate(BANNER)).toBe('rc=0');
  });

  it('a session the operator stopped during the jitter is not revived: watchdog-cancel, lastswap put back', () => {
    seed(); fleet(); h.sh(`_reg_set ${ID} lastswap ${T0}`);
    writeTranscript([limitRow(T0 - 60)]);   // the transcript rung would still read the old limit row
    fs.writeFileSync(regFile(`${ID}.stopped`), '');
    expect(gate(PROMPT, '', { CCD_SWAP_PREV: '777' })).toBe('rc=1');
    expect(lines('watchdog-cancel')).toEqual([expect.stringMatching(/watchdog-cancel lane-a-project-a: stopped$/)]);
    expect(field(ID, 'lastswap')).toBe('777');
  });

  it('a hibernated session is not woken by the swap either', () => {
    seed(); fleet();
    fs.writeFileSync(regFile(`${ID}.hibernated`), '');
    expect(gate(BANNER)).toBe('rc=1');
    expect(lines('watchdog-cancel')).toEqual([expect.stringMatching(/watchdog-cancel lane-a-project-a: hibernated$/)]);
  });

  it('a session that is no longer live (a probe that finds no pane) is not respawned', () => {
    seed(); fleet(); writeTranscript([limitRow(T0 - 60)]);
    expect(gate(PROMPT, '_session_probe() { PROBE_VERDICT=gone; PROBE_SUBSTRATE=present; };')).toBe('rc=1');
    expect(lines('watchdog-cancel')).toEqual([expect.stringMatching(/watchdog-cancel lane-a-project-a: not live \(gone\)$/)]);
  });

  it('an unanswered probe cancels as well: the act is not taken on a session nobody can see', () => {
    seed(); fleet();
    expect(gate(BANNER, '_session_probe() { PROBE_VERDICT=unknown; PROBE_SUBSTRATE=present; };')).toBe('rc=1');
    expect(lines('watchdog-cancel')).toEqual([expect.stringMatching(/not live \(unknown\)$/)]);
  });

  it('cmd_swap runs it for the watchdog arm and names the cause swap-auto-rescue', () => {
    expect(h.sh('CCD_SWAP_AUTO=1 CCD_SWAP_ARM=watchdog _swap_end_cause')).toBe('swap-auto-rescue');
    expect(ccdSource()).toMatch(/watchdog\) +_swap_watchdog_act_gate "\$id" "\$cur" \|\| return 0 ;;/);
  });
});

describe('no account has room: ccd chooses "Wait until reset" itself (D-8173 ruling (a))', () => {
  it('a stopped session with a stated reset gets choice=wait by=auto, said once in the log', () => {
    seed(); fullFleet();
    pass(BANNER, T0); pass(BANNER, T0 + 300); pass(BANNER, T0 + 360);
    expect(lines('limit-wait')).toEqual([expect.stringMatching(/limit-wait lane-a-project-a: choice=wait account=claude sign=banner by=auto$/)]);
    expect(field(ID, 'limitwait')).toMatch(/ choice=wait at=1900000300 by=auto$/);
    expect(dispatches()).toEqual([]);
  });

  it('an account-only sign is not a stopped session: no automatic choice', () => {
    seed(); limits('claude', 99, 10, { fiveResetAt: T0 + 10000 }); limits('claude-a', 100, 100); limits('claude-b', 100, 100); processStatus();
    pass(PROMPT, T0); pass(PROMPT, T0 + 300);
    expect(field(ID, 'limitwait')).toMatch(/ sign=account$/);
    expect(lines('limit-wait')).toEqual([]);
  });

  it('a record with no stated reset ("-") stays the operator\'s: no automatic choice', () => {
    seed(); limits('claude-a', 100, 100); limits('claude-b', 100, 100);
    h.sh(`_reg_set ${ID} limitwait "state=open since=${T0} reset=- account=claude sign=banner"`);
    pass(BANNER, T0); pass(BANNER, T0 + 300, '_rescue_target() { return 1; };');
    expect(field(ID, 'limitwait')).toBe(`state=open since=${T0} reset=- account=claude sign=banner`);
    expect(lines('limit-wait')).toEqual([]);
  });

  it('room appears before the reset: the automatic wait is not a pin, the rescue moves the session', () => {
    seed(); fullFleet();
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(field(ID, 'limitwait')).toMatch(/by=auto$/);
    limits('claude-b', 20, 20);
    pass(BANNER, T0 + 360);
    expect(dispatches()).toEqual([expect.stringMatching(/ -> claude-b watchdog$/)]);
    expect(detached()).toEqual([]);
  });

  it('the reset passes with no room elsewhere: the session restarts in place on its own account', () => {
    seed(); fullFleet(); processStatus();
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    limits('claude', 10, 10);
    pass(BANNER, T0 + 10060);
    expect(lines('watchdog-resume')).toEqual([expect.stringMatching(/watchdog-resume lane-a-project-a: claude after reset$/)]);
    expect(dispatches()).toEqual([]);
    expect(field(ID, 'limitwait')).toMatch(/^state=closed .* choice=wait at=\d+ by=auto end=resume until=\d+$/);
  });

  it('the operator\'s own choice is still a pin: room elsewhere moves nothing', () => {
    seed(); fleet();
    h.sh(`_reg_set ${ID} limitwait "state=open since=${T0 - 400} reset=${T0 + 5000} account=claude sign=banner choice=wait at=${T0 - 300}"`);
    pass(BANNER, T0); pass(BANNER, T0 + 600);
    expect(dispatches()).toEqual([]);
  });

  it('the operator\'s tap on an automatic choice keeps it automatic', () => {
    seed(); fullFleet();
    pass(BANNER, T0); pass(BANNER, T0 + 300);
    expect(h.sh(`_limitwait_choose ${ID}; echo rc=$?`)).toMatch(/rc=0$/);
    expect(field(ID, 'limitwait')).toMatch(/ choice=wait at=1900000300 by=auto$/);
    expect(h.sh(`_limitwait_choose ${ID} other; echo rc=$?`)).toMatch(/rc=1$/);
  });
});

describe('Wait until reset: the operator\'s choice is honoured, then the session restarts in place', () => {
  const waitRecord = (reset: string, extra = ''): void => {
    h.sh(`_reg_set ${ID} limitwait "state=open since=${T0 - 400} reset=${reset} account=claude sign=banner choice=wait at=${T0 - 300}${extra}"`);
  };

  it('while the reset is ahead: no rescue even with measured room elsewhere, nothing typed', () => {
    seed(); fleet(); waitRecord(String(T0 + 5000));
    pass(BANNER, T0); pass(BANNER, T0 + 600);
    expect(dispatches()).toEqual([]);
    expect(detached()).toEqual([]);
    expect(field(ID, 'limitwait')).toMatch(/choice=wait/);
  });

  it('the reset passed and its own account has measured room: watchdog-resume, same account, in a transient unit', () => {
    seed(); limits('claude', 10, 10); limits('claude-a', 5, 5); waitRecord(String(T0 - 60)); processStatus();
    pass(BANNER, T0);
    expect(lines('watchdog-resume')).toEqual([expect.stringMatching(/watchdog-resume lane-a-project-a: claude after reset$/)]);
    // The unit sources the ccd BODY (the installed `~/.local/bin/ccd` is a launcher) and runs the restart function.
    expect(detached()).toEqual([expect.stringMatching(/^detached bash -c source \S*\/ccd\/ccd && _watchdog_resume_run lane-a-project-a >>/)]);
    expect(dispatches()).toEqual([]);
    expect(field(ID, 'lastend')).toBe(`${T0} limit-resume`);
    expect(lines('ended')).toEqual([expect.stringMatching(/ended lane-a-project-a: limit-resume$/)]);
    expect(field(ID, 'limitwait')).toMatch(/^state=closed .* choice=wait at=\d+ end=resume until=\d+$/);
    expect(field(ID, 'lastswap')).toBe(String(T0));
  });

  it('the reset passed but its own account is still full: it keeps waiting', () => {
    seed(); fleet(); waitRecord(String(T0 - 60));
    pass(BANNER, T0);
    expect(detached()).toEqual([]);
    expect(lines('watchdog-resume')).toEqual([]);
  });

  it('a reset that is not known ("-") never ends the wait by the clock, even on an account that reads low', () => {
    // `_limitwait_open` writes `-` for a pane, banner or menu sign whose account reads under the ceiling: the stale low
    // reading is exactly the case where "the account has room" is wrong, and a restart would hit the limit again.
    seed(); fleet(); waitRecord('-'); processStatus();
    pass(BANNER, T0); expect(detached()).toEqual([]);
    limits('claude', 30, 30);
    pass(BANNER, T0 + 60); pass(BANNER, T0 + 3600); pass(BANNER, T0 + 86400);
    expect(detached()).toEqual([]);
    expect(lines('watchdog-resume')).toEqual([]);
    expect(dispatches()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/watchdog-hold lane-a-project-a: the wait has no reset time/)]);   // said once
    expect(field(ID, 'limitwait')).toMatch(/^state=open .* choice=wait/);
  });

  it('a wait with no reset still ends when the sign clears on its own', () => {
    seed(); limits('claude', 30, 30); waitRecord('-'); processStatus();
    pass(BANNER, T0);
    pass(PROMPT, T0 + 60);
    expect(detached()).toEqual([]);
    expect(field(ID, 'limitwait')).toMatch(/^state=closed .* end=clear until=\d+$/);
  });

  it('a reset that has passed while the session moved inside SWAP_COOLDOWN (a tick rescue just dispatched): no second move', () => {
    seed(); limits('claude', 10, 10); waitRecord(String(T0 - 60)); processStatus();
    h.sh(`_reg_set ${ID} lastswap ${T0 - 30}`);
    pass(BANNER, T0);
    expect(detached()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/the session moved 30s ago/)]);
    pass(BANNER, T0 + 900);   // the cooldown over: the restart goes ahead
    expect(detached()).toHaveLength(1);
  });

  it('a reset that has passed while a swap dispatch is pending (its claim is younger than the jitter window): no second move', () => {
    seed(); limits('claude', 10, 10); waitRecord(String(T0 - 60)); processStatus();
    fs.writeFileSync(regFile(`${ID}.dispatching`), `${T0 - 20}\n`);
    pass(BANNER, T0);
    expect(detached()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/a swap dispatched at \d+ is still pending/)]);
    fs.writeFileSync(regFile(`${ID}.dispatching`), `${T0 + 100 - 400}\n`);   // older than SWAP_JITTER + 60: a dead claim
    pass(BANNER, T0 + 100);
    expect(detached()).toHaveLength(1);
  });

  it('a reset that has passed while a turn runs (Claude Code continued by itself): the turn is not killed', () => {
    seed(); limits('claude', 10, 10); waitRecord(String(T0 - 60));
    processStatus('busy');
    pass(BANNER, T0);
    expect(detached()).toEqual([]);
    expect(lines('watchdog-hold')).toEqual([expect.stringMatching(/not at a clean turn boundary/)]);
    processStatus('idle');
    pass(`${BUSY}\n${BANNER_LINE}`, T0 + 60);    // the pane still reads `esc to interrupt`
    expect(detached()).toEqual([]);
    pass(BANNER, T0 + 120);
    expect(detached()).toHaveLength(1);
  });

  it('a reset that has passed while background work is live: not restarted', () => {
    seed(); limits('claude', 10, 10); waitRecord(String(T0 - 60)); processStatus();
    bgMarker(1, T0 - 100, 'subagent');
    pass(BANNER, T0);
    expect(detached()).toEqual([]);
  });

  it('the sign gone on its own closes the wait without restarting anything', () => {
    seed(); limits('claude', 10, 10); waitRecord(String(T0 + 5000));
    pass(PROMPT, T0);
    expect(detached()).toEqual([]);
    expect(field(ID, 'limitwait')).toMatch(/^state=closed .* end=clear until=\d+$/);
  });

  it('four waiting sessions on one account resume three in a pass, the fourth the next pass (no herd at the reset)', () => {
    for (const id of IDS) {
      seed(id);
      h.sh(`_reg_set ${id} limitwait "state=open since=${T0 - 400} reset=${T0 - 60} account=claude sign=banner choice=wait at=${T0 - 300}"`);
    }
    limits('claude', 10, 10); limits('claude-a', 5, 5); processStatus();
    pass(BANNER, T0);
    expect(detached()).toHaveLength(3);
    expect(lines('watchdog-resume')).toHaveLength(3);
    const open = IDS.filter((id) => /^state=open /.test(field(id, 'limitwait') ?? ''));
    expect(open).toHaveLength(1);
    pass(BANNER, T0 + 60);
    expect(detached()).toHaveLength(4);
    expect(new Set(detached().map((l) => l.match(/_watchdog_resume_run (\S+)/)?.[1])).size).toBe(4);
    expect(IDS.filter((id) => /^state=open /.test(field(id, 'limitwait') ?? ''))).toEqual([]);
  });

  it('a resume that could not start does not use the pass\'s budget', () => {
    for (const id of IDS) {
      seed(id);
      h.sh(`_reg_set ${id} limitwait "state=open since=${T0 - 400} reset=${T0 - 60} account=claude sign=banner choice=wait at=${T0 - 300}"`);
    }
    limits('claude', 10, 10); processStatus();
    pass(BANNER, T0, '_svc_run_detached() { return 1; };');
    expect(lines('dispatch FAILED')).toHaveLength(4);
  });

  it('a failed unit start puts lastswap back and leaves the wait open', () => {
    seed(); limits('claude', 10, 10); waitRecord(String(T0 - 60)); processStatus(); h.sh(`_reg_set ${ID} lastswap 55`);
    pass(BANNER, T0, '_svc_run_detached() { return 1; };');
    expect(field(ID, 'lastswap')).toBe('55');
    expect(field(ID, 'limitwait')).toMatch(/^state=open /);
  });
});

describe('_watchdog_resume_run: the stop-and-ensure a swap does, on the same account', () => {
  it('stops the unit, kills the pane, ensures the session, and types nothing', () => {
    seed();
    h.sh(`_svc_stop() { echo "svc-stop $*" >> "$HOME/ccd-calls"; }
          sleep() { :; }
          tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; return 0; }
          _operator_choice_keep() { echo "choice-keep $*" >> "$HOME/ccd-calls"; }
          cmd_ensure() { echo "ensure $*" >> "$HOME/ccd-calls"; }
          _watchdog_resume_run ${ID}`);
    const calls = h.calls();
    expect(calls.indexOf(`choice-keep ${ID}`)).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf(`svc-stop claude-session@${ID}`)).toBeGreaterThan(calls.indexOf(`choice-keep ${ID}`));
    expect(calls.findIndex((l) => l.startsWith('tmux kill-session'))).toBeGreaterThan(calls.indexOf(`svc-stop claude-session@${ID}`));
    expect(calls.indexOf(`ensure ${ID}`)).toBeGreaterThan(calls.findIndex((l) => l.startsWith('tmux kill-session')));
  });

  it('limit-resume is a cause the resume prompt names', () => {
    seed(); h.sh(`_reg_set ${ID} lastend "${Math.floor(Date.now() / 1000)} limit-resume"`);
    expect(h.sh(`_resume_prompt_for ${ID}`)).toContain('same account after its usage limit reset');
  });
});
