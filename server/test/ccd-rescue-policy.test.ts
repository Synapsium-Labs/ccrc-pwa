// The rescue policy (session-continuity spec §5.4, rules 2–3; wave 2, D-3498).
//
// Rule 1 — a carried-in banner is not a block — shipped as D-3526 and is pinned
// in `ccd-limit-banner.test.ts`. What this file pins sits between that verdict
// and the rescue arm's `_dispatch_swap`, and each case is red when its guard is
// removed (the plan's mutation tables are the measurement):
//   - THE DATED ROW: the verdict keeps a rate-limit row's `resetsAt`, window and
//     epoch only from an rc-0 read of this process's transcript — never on lost
//     auth, an unplaced process, a carried-in row, or a reset the row was
//     written after;
//   - RULE 2: a `five_hour` block whose reset is inside RESCUE_WAIT_BOUND, with
//     Claude Code's auto-continue armed — its own footer, never a draft or a
//     line of prose saying the words — WAITS instead of swapping, recorded once
//     on entry and once on exit in `$REG/<id>.rescuewait`, and ends at the reset
//     or RESCUE_WAIT_GRACE after it; today's strand is the no-room wait.
// Every fixture sits past SWAP_COOLDOWN (no `lastswap`, no `swapblocked`), and
// the pane's process was born a day before every row unless a case says not.
//
// FIXTURE HOME ONLY (`makeCcdHarness`): tmux, `_dispatch_swap` and — where a
// case is about the verdict rather than the choice — `_swap_target` are shell
// functions that LOG.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-rescue-policy-'); });
afterEach(() => { h.cleanup(); });

const ID = 'claude-demo';
const UUID = 'deadbeef-0000-4000-8000-000000000000';
const now = (): number => Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

const seed = (wrapper = 'claude'): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home claude
        _reg_set ${ID} project demo
        _reg_set ${ID} workdir "$HOME/projects/demo"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'demo'), { recursive: true });
};

/** The row Claude Code appends on a 429 (the `ccd-limit-banner.test.ts` shape),
 *  with the three fields the waits read: its own timestamp, `resetsAt` and
 *  `rateLimitType`. */
const limitRow = (at: number, reset: number | null, type: string | null): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  ...(reset === null && type === null ? {} : { quotaLimits: { status: 'rejected', ...(reset === null ? {} : { resetsAt: reset }), ...(type === null ? {} : { rateLimitType: type }) } }),
});
/** Claude Code 2.1.280's own 401 row, field for field as `ccd-limit-banner.test.ts` has it. */
const authRow = (at: number): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `e${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'Invalid API key · Fix external API key' }] },
  isApiErrorMessage: true, error: 'authentication_failed', apiErrorStatus: 401,
});
const turn = (at: number, text = 'Working on it.'): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text }] },
});
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};

/** Pane texts. ARMED is Claude Code's own auto-continue banner, matched by the
 *  REAL `_pane_hard_blocked` ("limit reached") and `_pane_auto_continue_armed`;
 *  STALLED is this year's banner with no continuation beside it (D-3100's rung);
 *  AUTH is lost auth, which `_pane_hard_blocked` also matches. The capture is
 *  REAL multi-line text (`tick` writes it to a file tmux's stub cats), so a case
 *  can draw 2.1.280's layout: banners above the prompt box, the auto-continue
 *  footer below it, a draft inside it. */
const ARMED = 'Usage limit reached · continuing automatically at 9:10pm · esc to cancel\n❯ ';
const STALLED = "You've hit your session limit · resets 9:10pm (UTC)\n❯ ";
const PROMPT = '? for shortcuts\n❯ ';
const AUTH = 'Invalid API key · Please run /login\n❯ ';
const BORDER = '────────────────────────────';
/** A STALLED banner above the box, with a human's draft in it that says the words. */
const DRAFT_SAYS_IT = `${STALLED.split('\n')[0]}\n${BORDER}\n❯ ok, continuing shortly\n${BORDER}\n  ? for shortcuts`;

/** tmux answers ONE pane for every capture — `pane`, written to `$HOME/pane.txt`
 *  line for line — and, while `TMUX_CREATED` is set, the pane's
 *  `session_created`; `_pane_box_draft` finds no draft; the dispatch and every
 *  keystroke LOG. `target` stubs `_swap_target` (null = leave it real). */
const STUBS = (pane: string, target: string | null = 'claude-a'): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; ${WIDE_PANE} case "\${1:-}" in
    capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo 4242 ;;
    display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  _pane_box_draft() { printf ''; };
  ${target === null ? '' : `_swap_target() { [[ -n ${JSON.stringify(target)} ]] && echo ${JSON.stringify(target)}; return 0; };`}
  _dispatch_swap() { echo "dispatch $1 -> $2" >> "$HOME/ccd-calls"; };`;
};
/** This pane's process was born a day ago — before every row a case writes. */
const BORN = (): Record<string, string> => ({ TMUX_CREATED: String(now() - 86400) });
const tick = (pane: string, target: string | null = 'claude-a', env: Record<string, string> = BORN()): void => {
  h.sh(`${STUBS(pane, target)} _auto_swap_check ${ID}`, env);
};
/** One verdict, and the three globals the waits read, printed as `reset|type|row`. */
const dated = (pane: string, env: Record<string, string> = BORN()): string =>
  h.sh(`${STUBS(pane)} _session_hard_blocked ${ID} ${JSON.stringify(pane)}; echo "$?|$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`, env);
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const keystrokes = (): string[] => h.calls().filter((l) => l.startsWith('tmux send-keys'));
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const logLines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const field = (rec: string | null, key: string): string | undefined =>
  rec === null ? undefined : new RegExp(`(?:^| )${key}=(\\S*)`).exec(rec)?.[1];
const openWait = (kind: string, since: number, reset: number | string, wrapper = 'claude'): void => {
  h.sh(`_reg_set ${ID} rescuewait "state=open kind=${kind} since=${since} reset=${reset} wrapper=${wrapper}"`);
};

// ── THE DATED ROW ─────────────────────────────────────────────────────────────

describe('the dated row the waits read (session-continuity §5.4 rule 2)', () => {
  it('a rate-limit row this process wrote is dated on the pane rung: its reset, its window, its own epoch', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    expect(dated(ARMED)).toBe(`0|${t + 300}|five_hour|${t - 5}`);
  });

  it('the transcript rung dates its positive on the tick its tscan cache answers, too', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    expect(dated(PROMPT)).toBe(`0|${t + 300}|five_hour|${t - 5}`);
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 1$/);
    expect(dated(PROMPT), 'the cached tick lost the row').toBe(`0|${t + 300}|five_hour|${t - 5}`);
  });

  it('the globals are cleared on every call — one supervise shell runs every tick', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    const out = h.sh(`${STUBS(ARMED)} _session_hard_blocked ${ID} ${JSON.stringify(ARMED)}; a="$HARD_BLOCK_RESET";
      _session_hard_blocked ${ID} ${JSON.stringify(AUTH)}; echo "$a|$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`, BORN());
    expect(out).toBe(`${t + 300}|||`);
  });

  it('_hard_block_date keeps nothing for an unplaced process, a 401 or another answer, and no reset a row was written at or after', () => {
    const ask = (rc: string, born: string, row: string): string =>
      h.sh(`_hard_block_date ${rc} ${JSON.stringify(born)} $'${row}'; echo "$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`);
    expect(ask('0', '5', '100\\t200\\tfive_hour')).toBe('200|five_hour|100');
    expect(ask('0', '', '100\\t200\\tfive_hour'), 'tmux could not say when the pane was born').toBe('||');
    expect(ask('0', 'soon', '100\\t200\\tfive_hour')).toBe('||');
    expect(ask('0', '5', '-\\t-\\t-'), "a 401's answer").toBe('||');
    expect(ask('1', '5', '100\\t200\\tfive_hour'), 'rc 1 is no block row').toBe('||');
    expect(ask('2', '5', '100\\t200\\tfive_hour'), 'rc 2 is unread').toBe('||');
    expect(ask('0', '5', '300\\t200\\tfive_hour'), 'written after its own reset').toBe('|five_hour|300');
    expect(ask('0', '5', '200\\t200\\tfive_hour'), 'written in its own reset second').toBe('|five_hour|200');
    expect(ask('0', '5', '100\\t-\\t-'), 'a row with no quotaLimits keeps no window').toBe('||100');
    const marker = path.join(h.home, 'evaluated');
    expect(ask('0', '5', `100\\tREG[$(touch ${marker})]\\tfive_hour`)).toBe('|five_hour|100');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('an unplaced process takes no wait: tmux cannot say when the pane was born, and a near reset on an armed pane dispatches as today', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED, 'claude-a', {});
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });

  it('lost auth takes no wait: a 401 this process wrote after a near-reset rate-limit row dispatches, armed or not', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 100, t + 300, 'five_hour'), authRow(t - 5)]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dated(ARMED)).toBe('0|||');
  });

  // [rate-limit row, a turn, a 401]: whoever wrote the 401, it is the newer row,
  // so the reader never answers the rate-limit row under it (measured in
  // `ccd-limit-banner.test.ts`: no born or a torn one, rc 1; born before the
  // 401, the 401; born after it, rc 1).
  it.each([
    ['this process wrote the 401', (t: number) => ({ TMUX_CREATED: String(t - 86400) })],
    ['an earlier process wrote it, and a swap carried it here', (t: number) => ({ TMUX_CREATED: String(t - 900) })],
    ['tmux cannot place the pane', (_t: number) => ({})],
  ])('lost auth takes no wait: [rate-limit row, a turn, a 401] under an armed near-reset footer strands with no record, then dispatches — %s', (_what, env) => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour'), turn(t - 2900), authRow(t - 2800)]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}`);
    tick(ARMED, '', env(t));
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(logLines('carried-in')).toEqual([]);
    tick(ARMED, 'claude-a', env(t));
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('an auth-failure pane is never dated, even beside an armed footer over a near-reset row: it dispatches, and strands with no record', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    const pane = `Invalid API key · Please run /login\n${ARMED}`;
    expect(dated(pane)).toBe('0|||');
    tick(pane, '');
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    tick(pane);
    expect(dispatches()).toHaveLength(1);
  });

  // D-3526's ruling: a landing whose Claude Code never came up is still moved.
  // Its row is carried in (rc 3), so it dates nothing — and with no live TUI
  // there is no armed auto-continue either; the footer below is forced.
  it('a landing that never came up is moved as today and takes no wait, even beside an armed footer (D-3526)', () => {
    seed(); const t = now(); const born = t - 990;
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour')]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 4"`);
    expect(dated(ARMED, { TMUX_CREATED: String(born) }), 'a carried-in row keeps no reset and no window').toMatch(/^0\|\|\|/);
    tick(ARMED, '', { TMUX_CREATED: String(born) });
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    tick(ARMED, 'claude-a', { TMUX_CREATED: String(born) });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: the same carried row on a process that came up is carried in — no rescue, no wait', () => {
    seed(); const t = now(); const born = t - 990;
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour')]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 0"`);
    tick(ARMED, 'claude-a', { TMUX_CREATED: String(born) });
    expect(dispatches()).toEqual([]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(logLines('carried-in')).toHaveLength(1);
  });
});

// ── RULE 2 — wait near the account's own five-hour reset ─────────────────────

describe('rule 2: the near-reset wait (C6, C13)', () => {
  it('a five_hour row whose reset is 300 s out, auto-continue armed: no dispatch, one entry line, and the record', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED); tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(logLines('rescuewait'), swapLog()).toHaveLength(1);
    const rec = h.reg(ID, 'rescuewait');
    expect(field(rec, 'state')).toBe('open');
    expect(field(rec, 'kind')).toBe('near');
    expect(field(rec, 'reset')).toBe(String(t + 300));
    expect(field(rec, 'wrapper')).toBe('claude');
    expect(keystrokes(), 'a wait types nothing').toEqual([]);
  });

  it('a seven_day row 300 s out dispatches — only the five-hour window is waited on', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'seven_day')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('RESCUE_WAIT_BOUND=0 turns the wait off: it dispatches', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_BOUND=0; _auto_swap_check ${ID}`, BORN());
    expect(dispatches()).toHaveLength(1);
  });

  it('RESCUE_WAIT_BOUND=0 turns the wait off INSIDE the grace too: a reset that just passed dispatches', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 500, t - 30, 'five_hour')]);
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_BOUND=0; _auto_swap_check ${ID}`, BORN());
    expect(dispatches()).toHaveLength(1);
  });

  it('the grace is its OWN constant: RESCUE_WAIT_GRACE moves the end, STALE_PRESS_COOLDOWN does not', () => {
    seed(); const t = now(); const R = t - 60;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('near', t - 500, R);
    h.sh(`${STUBS(ARMED)} STALE_PRESS_COOLDOWN=30; _auto_swap_check ${ID}`, BORN());
    expect(field(h.reg(ID, 'rescuewait'), 'state'), 'STALE_PRESS_COOLDOWN ended the wait').toBe('open');
    h.sh(`${STUBS(ARMED)} RESCUE_WAIT_GRACE=30; _auto_swap_check ${ID}`, BORN());
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(dispatches()).toEqual([]);
  });

  it('a reset outside the bound dispatches at once', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 900, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a STALLED session (no armed auto-continue) is rescued as today, reset or no reset', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(STALLED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a non-Anthropic lane never waits on a reset', () => {
    seed('gpt'); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a row carrying no reset swaps as today — ~/.cc-limits is not a fallback', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, null, 'five_hour')]);
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude.json'),
      JSON.stringify({ five: 100, seven: 10, ts: t, fiveResetAt: t + 300, sevenResetAt: t + 400000 }));
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('an open near wait holds through the reset and its grace, even once the pane stops saying armed', () => {
    seed(); const t = now(); const R = t - 60;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('near', t - 500, R);
    tick(STALLED);
    expect(dispatches()).toEqual([]);
  });

  it('the verdict clearing at the reset (Claude Code continued) ends the wait, once, as `clear`', () => {
    seed(); const t = now(); const R = t - 10;
    writeTranscript([limitRow(t - 500, R, 'five_hour'), turn(t - 2)]);
    openWait('near', t - 500, R);
    tick(PROMPT); tick(PROMPT);
    expect(dispatches()).toEqual([]);
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('clear');
  });

  it('GRACE after the reset with no newer row, armed: the wait ends in place and nothing dispatches on this reset, inside RESCUE_CHAIN_WAIT', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour')]);
    openWait('near', t - 800, R);
    tick(ARMED); tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(keystrokes(), 'nothing is typed in place').toEqual([]);
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('GRACE after the reset WITH a rate-limit row newer than the reset: a dispatch follows', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour'), turn(t - 150), limitRow(t - 100, t + 17000, 'five_hour')]);
    openWait('near', t - 800, R);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('a turned record on ANOTHER account does not hold this one — two accounts can share a reset epoch', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 300, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude-b until=2 end=turned"`);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a STALLED session whose closed turned record names this reset is rescued', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude until=2 end=turned"`);
    tick(STALLED);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: an ARMED session whose closed turned record names this reset is held', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude until=2 end=turned"`);
    tick(ARMED);
    expect(dispatches()).toEqual([]);
  });

  // A ROW WRITTEN AT OR AFTER ITS OWN resetsAt keeps no reset (§5.4 rule 2: "no
  // wait of any kind keys on" it). Such rows are real: a 14-day survey of this
  // fleet's transcripts found `five_hour` rows whose resetsAt was 10 hours to
  // 8.5 days before their own timestamp.
  it('a row written AFTER its own resetsAt opens no wait of any kind: stranded with no record, then rescued when room appears', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t - 36857, 'five_hour')]);
    tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(h.reg(ID, 'rescuewait'), 'a no-room wait keyed on a reset that never turned the account').toBeNull();
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('armed, a row newer than its reset: no near wait', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t - 60, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a rate-limit row written after the reset with the SAME resetsAt ends the wait in a swap', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 800, R, 'five_hour'), turn(t - 150), limitRow(t - 50, R, 'five_hour')]);
    openWait('near', t - 800, R);
    tick(ARMED); tick(ARMED); tick(STALLED);
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('no target with room: no dispatch, a stranded record, and the no-room wait — recorded once', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    tick(STALLED, ''); tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('noroom');
    expect(field(h.reg(ID, 'rescuewait'), 'reset')).toBe(String(t + 9000));
    expect(logLines('rescuewait')).toHaveLength(1);
    tick(STALLED, 'claude-a');
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('an open wait taken on another account ends as a swap, and the wait on this account opens beside it', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    openWait('noroom', t - 900, t + 9000, 'claude-b');
    tick(STALLED, '');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(logLines('rescuewait-end')[0]).toMatch(/kind=noroom on claude-b .* end=swap$/);
    expect(field(h.reg(ID, 'rescuewait'), 'wrapper')).toBe('claude');
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('an ARMED no-room wait that crosses its own reset ends in place, never in a swap, even once a target has room', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    openWait('noroom', t - 5000, R);
    fs.writeFileSync(regFile(`${ID}.stranded`), '1');
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(fs.existsSync(regFile(`${ID}.stranded`)), 'held on its own reset is not stranded').toBe(false);
  });

  // A STALLED pane has nothing that re-sends its turn in place, and ccd types
  // nothing there — so across its own reset it is rescued exactly as today's
  // strand is: it waits while no target has room, and swaps the moment one does.
  it('a STALLED no-room wait across its own reset is rescued once a target has room, not held', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    openWait('noroom', t - 5000, R);
    tick(STALLED, ''); tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state'), 'the no-room wait ended at a reset nothing re-sent').toBe('open');
    expect(logLines('rescuewait'), 'a no-room wait re-opened per tick').toHaveLength(0);
    tick(STALLED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(keystrokes(), 'nothing typed in place').toEqual([]);
  });

  // …and the same inside the grace after its reset: today's strand swaps the
  // moment a target has room, and five-hour resets fall on shared boundaries,
  // so another account gaining room in exactly that window is the usual case.
  it('a STALLED no-room wait inside its reset grace swaps the moment a target has room', () => {
    seed(); const t = now(); const R = t - 30;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('noroom', t - 500, R);
    tick(STALLED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('control: an ARMED no-room wait inside its reset grace is held', () => {
    seed(); const t = now(); const R = t - 30;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('noroom', t - 500, R);
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
    expect(field(h.reg(ID, 'rescuewait'), 'kind'), 'the no-room wait was replaced, not held').toBe('noroom');
    expect(logLines('rescuewait-end')).toEqual([]);
  });

  it('armed, a reset that passed inside the grace with no record: the near wait opens (the control for RESCUE_WAIT_BOUND=0)', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 500, t - 30, 'five_hour')]);
    tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('near');
  });

  it('an open near wait holds from entry, before its reset, even once the pane stops saying armed', () => {
    seed(); const t = now(); const R = t + 200;
    writeTranscript([limitRow(t - 100, R, 'five_hour')]);
    openWait('near', t - 100, R);
    tick(STALLED);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('a wait of the same kind on the same account but another reset is a new wait: the old one ends, the new one opens', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    openWait('noroom', t - 900, t + 5000);
    tick(STALLED, '');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'reset')).toBe(String(t + 9000));
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('a seven_day block with no target that has room records the no-room wait with reset=- (only a five-hour reset is recorded)', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 90000, 'seven_day')]);
    tick(STALLED, '');
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('noroom');
    expect(field(h.reg(ID, 'rescuewait'), 'reset')).toBe('-');
  });

  it('a closed record on this reset that did not end turned holds nothing: an armed pane past the grace is rescued as today', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    h.sh(`_reg_set ${ID} rescuewait "state=closed kind=near since=1 reset=${R} wrapper=claude until=2 end=clear"`);
    tick(ARMED);
    expect(dispatches()).toHaveLength(1);
  });

  it('a held tick is a decision: it clears a standing tickstuck stamp', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    fs.writeFileSync(regFile(`${ID}.tickstuck`), 'project');
    tick(ARMED);
    expect(dispatches()).toEqual([]);
    expect(fs.existsSync(regFile(`${ID}.tickstuck`))).toBe(false);
  });

  // ARMED IS CLAUDE CODE'S OWN FOOTER. A false "armed" here parks a STALLED
  // session — nothing re-sends its turn — so the words alone are not enough:
  // not in a human's draft inside the prompt box, and not in prose without the
  // footer's `·` separator (the two pane rungs read their banners the same way).
  it('a human draft that says "continuing shortly" is not an armed auto-continue: a STALLED banner near its reset dispatches', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(DRAFT_SAYS_IT);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });

  it('…nor does that draft hold a STALLED no-room wait inside its reset grace once a target has room (S3)', () => {
    seed(); const t = now(); const R = t - 30;
    writeTranscript([limitRow(t - 500, R, 'five_hour')]);
    openWait('noroom', t - 500, R);
    tick(DRAFT_SAYS_IT, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('…nor does a draft that quotes the footer itself, separator and all', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`${STALLED.split('\n')[0]}\n${BORDER}\n❯ it said "Usage limit reached · continuing automatically at 9:10pm"\n${BORDER}\n  ? for shortcuts`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('…nor is the assistant\'s own last line saying "Continuing shortly" above a STALLED banner', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`⏺ Tests pass. Continuing shortly with Task 3.\n  ⎿  ${STALLED.split('\n')[0]}\n${BORDER}\n❯ \n${BORDER}\n  ? for shortcuts`);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: Claude Code\'s own footer, rendered BELOW the box, still waits', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`${STALLED.split('\n')[0]}\n${BORDER}\n❯ \n${BORDER}\n  Usage limit reached · continuing automatically at 9:10pm · esc to cancel`);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('near');
  });

  it('control: the 2.1.280 armed footer under the box\'s bottom border still waits', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(`✻ Churned for 0s · done 4:01 PM\n${BORDER}\n❯ \n${BORDER}\n  ⚠ Usage limit reached · continuing automatically at 5:49pm · esc to cancel`);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('near');
  });

  // A WAIT FIRST TAKEN AFTER ITS RESET'S GRACE never saw the account turn: an
  // armed footer 10 minutes past its reset, with the 429 still the newest row,
  // says Claude Code is NOT continuing — so it is not ended `turned` and held
  // (inside RESCUE_CHAIN_WAIT, where the bound below would not end the hold).
  it('a wait first taken long after its reset never ends `turned`: an ARMED pane 10 min past its reset is rescued once a target has room', () => {
    seed(); const t = now(); const R = t - 600;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    tick(ARMED, ''); tick(ARMED, '');
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('control: a no-room wait open since before its reset still ends `turned` on an ARMED pane and holds', () => {
    seed(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    openWait('noroom', t - 5000, R);
    tick(ARMED, 'claude-a');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  // THE HOLD AFTER A RESET TURNED IS BOUNDED, at RESCUE_CHAIN_WAIT past that
  // reset (the planner's default; Open question 4): an ARMED footer that far
  // past its reset, with the 429 still the newest row, says Claude Code is not
  // continuing, and `main` rescues that input at once. `date +%s` is stubbed to
  // move the clock, so the shipped constants are the ones read.
  const clock = (epoch: number): string => `date() { [[ "$1" == +%s ]] && echo ${epoch} || command date "$@"; };`;
  it('the hold after a reset turned ends RESCUE_CHAIN_WAIT past it: held at R+GRACE+60 and at R+RESCUE_CHAIN_WAIT-60, rescued at R+RESCUE_CHAIN_WAIT+60', () => {
    seed(); const t = now();
    const [GRACE, CHAIN] = h.sh('echo "$RESCUE_WAIT_GRACE $RESCUE_CHAIN_WAIT"').split(' ').map(Number);
    const R = t - GRACE - 60;
    writeTranscript([limitRow(R - 800, R, 'five_hour')]);
    openWait('near', R - 300, R);
    h.sh(`${STUBS(ARMED)} ${clock(R + GRACE + 60)} _auto_swap_check ${ID}`, BORN());
    expect(dispatches(), 'R+GRACE+60').toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('closed');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    h.sh(`${STUBS(ARMED)} ${clock(R + CHAIN - 60)} _auto_swap_check ${ID}`, BORN());
    expect(dispatches(), 'R+RESCUE_CHAIN_WAIT-60').toEqual([]);
    h.sh(`${STUBS(ARMED)} ${clock(R + CHAIN + 60)} _auto_swap_check ${ID}`, BORN());
    expect(dispatches(), 'R+RESCUE_CHAIN_WAIT+60').toEqual([`dispatch ${ID} -> claude-a`]);
    const rec = h.reg(ID, 'rescuewait');
    expect(field(rec, 'state'), 'the rescue arm writes nothing over a closed record').toBe('closed');
    expect(field(rec, 'kind')).toBe('near');
    expect(field(rec, 'end')).toBe('turned');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(logLines('rescuewait'), 'no second wait on this reset').toEqual([]);
    expect(keystrokes(), 'nothing typed in place').toEqual([]);
  });

  it('control: a STALLED pane past the grace is rescued as before — the bound changes nothing for it', () => {
    seed(); const t = now(); const R = t - 180;
    writeTranscript([limitRow(R - 800, R, 'five_hour')]);
    openWait('near', R - 300, R);
    tick(STALLED);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  // S2 AT THE RESET: the armed retry met a 429 carrying the SAME stale
  // resetsAt, so the newest row was written after the reset the no-room wait
  // keyed on — proof that reset did not turn the account. The wait ends
  // `stale` (the strand stands, as today), so §11 item 6 never counts it.
  it('a no-room wait whose reset a newer row proves did not turn the account ends `stale`, and the strand stands', () => {
    seed(); const t = now(); const R = t - 300;
    writeTranscript([limitRow(t - 2000, R, 'five_hour'), turn(R + 1), limitRow(R + 2, R, 'five_hour')]);
    openWait('noroom', t - 2000, R);
    tick(ARMED, ''); tick(ARMED, '');
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('stale');
    expect(logLines('rescuewait-end')).toHaveLength(1);
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(true);
  });

  it('control: with no retry row after the reset, that no-room wait ends `turned` on an ARMED pane', () => {
    seed(); const t = now(); const R = t - 300;
    writeTranscript([limitRow(t - 2000, R, 'five_hour')]);
    openWait('noroom', t - 2000, R);
    tick(ARMED, '');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('the word is never `hold`: the record is `.rescuewait`, no `.hold` is written, and swap.log never says it', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300, 'five_hour')]);
    tick(ARMED);
    expect(fs.existsSync(regFile(`${ID}.hold`))).toBe(false);
    expect(fs.existsSync(regFile(`${ID}.rescuewait`))).toBe(true);
    expect(swapLog()).not.toMatch(/\bhold\b/);
  });

  it('a torn record is never evaluated (D-299), and closes with its own fields', () => {
    seed();
    const marker = path.join(h.home, 'evaluated');
    h.sh(`_reg_set ${ID} rescuewait 'state=open kind=near since=REG[$(touch ${marker})] reset=REG[$(touch ${marker})] wrapper=claude'`);
    h.sh(`_rescuewait_close ${ID} clear`);
    expect(fs.existsSync(marker)).toBe(false);
    expect(field(h.reg(ID, 'rescuewait'), 'since')).toBe('0');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('clear');
  });

  it('.rescuewait purges with the row', () => {
    seed();
    openWait('near', 1, 2);
    h.sh(`_reg_purge ${ID}`);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });
});

describe('a completed swap ends an open wait as a swap, whoever asked for it', () => {
  const SWAP = 'systemctl() { echo "systemctl $*" >> "$HOME/ccd-calls"; }; launchctl() { echo "launchctl $*" >> "$HOME/ccd-calls"; }; '
    + 'tmux() { echo "tmux $*" >> "$HOME/ccd-calls"; }; sleep() { :; };';
  const seedSwap = (): void => {
    const wd = path.join(h.home, 'projects', 'demo');
    fs.mkdirSync(wd, { recursive: true });
    h.sh(`_reg_set ${ID} uuid ${UUID}; _reg_set ${ID} wrapper claude; _reg_set ${ID} project demo; _reg_set ${ID} workdir ${wd}`);
    openWait('noroom', 1, '-');
  };

  it('cmd_swap\'s landing closes it `swap`', () => {
    seedSwap();
    const mdir = fs.realpathSync(path.join(h.home, 'projects', 'demo')).replace(/[/._]/g, '-');
    const dir = path.join(h.home, '.claude', 'projects', mdir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${UUID}.jsonl`), 'HISTORY\n');
    h.sh(`${SWAP} cmd_swap ${ID} claude-d`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude-d');
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('a REFUSED swap leaves it open: nothing moved', () => {
    seedSwap();
    h.sh(`${SWAP} cmd_swap ${ID} claude-d >/dev/null 2>&1 || true`, { TMUX: '' });
    expect(h.reg(ID, 'wrapper')).toBe('claude');
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });
});

// ── RULE 3 — spread, do not bounce, chain-wait ────────────────────────────────

/** A swap.log line at `ago` seconds in the past, in the log's own LOCAL-time format. */
const pastLog = (ago: number, rest: string): void => {
  h.sh(`printf '%(%F %T)T %s\\n' "$(( $(date +%s) - ${ago} ))" ${JSON.stringify(rest)} >> "$REG/swap.log"`);
};

describe('rule 3: spread, no bounce, and the chain wait', () => {
  /** Real `_swap_target`: every home-able lane under the ceiling but `claude`,
   *  claude-a the least used, so an unskipped rescue from `claude` takes claude-a. */
  const lanes = (): void => {
    const t = now();
    for (const [w, five] of [['claude', 100], ['claude-a', 10], ['claude-b', 20], ['claude-d', 30]] as const) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
        JSON.stringify({ five, seven: 5, ts: t, fiveResetAt: t + 10000, sevenResetAt: t + 400000 }));
    }
  };
  const blockNow = (): void => { const t = now(); writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]); };
  const threeFrom = (from: string): void => {
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: ${from} (blocked) -> claude [home=claude]`);
  };

  it('the auto-rescue line carries the dated row: reset=, type= and row=', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 10, t + 9000, 'five_hour')]);
    tick(PROMPT);
    expect(logLines('auto-rescue')[0]).toMatch(new RegExp(`via=transcript reset=${t + 9000} type=five_hour row=${t - 10}$`));
  });

  it('control: with no history the least-used lane takes the rescue', () => {
    seed(); lanes(); blockNow();
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a target the session just left blocked is skipped', () => {
    seed(); lanes(); blockNow();
    pastLog(900, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
  });

  it('…unless its logged five-hour reset has already passed', () => {
    seed(); lanes(); blockNow();
    pastLog(900, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude] via=transcript reset=${now() - 60} type=five_hour row=1`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  // A reset the row was written after is never logged, so it lifts no skip: the
  // account the row proved still blocked is not taken back inside the hour.
  it('a row written days after its own reset logs no reset=, and the next rescue does not bounce back to that account', () => {
    seed('claude-a'); lanes(); const t = now();
    writeTranscript([limitRow(t - 5, t - 8 * 86400, 'seven_day')]);
    tick(STALLED, null);
    expect(logLines('auto-rescue')[0]).toMatch(new RegExp(`claude-a \\(blocked\\) -> claude-b \\[home=claude\\] via=banner type=seven_day row=${t - 5}$`));
    h.sh(`_reg_set ${ID} wrapper claude-b; _reg_set ${ID} lastswap ${t - 1000}`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`, `dispatch ${ID} -> claude-d`]);
  });

  it('spread: a target another session was rescued onto minutes ago is passed over while another has room', () => {
    seed(); lanes(); blockNow();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
  });

  it('control: a target rescued onto longer ago than RESCUE_SPREAD_WINDOW is not passed over', () => {
    seed(); lanes(); blockNow();
    pastLog(900, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it("control: other sessions' rescues neither count toward this session's chain wait nor mark an account it left", () => {
    seed(); lanes(); blockNow();
    for (const ago of [3000, 2500, 2000]) pastLog(ago, 'auto-rescue other-sess: claude-a (blocked) -> claude-d [home=claude]');
    tick(STALLED, null);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('control: rescues older than RESCUE_CHAIN_WINDOW neither count toward the chain wait nor skip the account left', () => {
    seed(); lanes(); blockNow();
    for (const ago of [5000, 4500, 4000]) pastLog(ago, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    tick(STALLED, null);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('spread is a preference: when the recent target is the only one with room, it is taken', () => {
    seed(); lanes(); blockNow();
    for (const w of ['claude-b', 'claude-d']) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`), JSON.stringify({ five: 100, seven: 5, ts: now() }));
    }
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a fourth rescue within the hour takes the chain wait — recorded with kind=chain, nothing dispatched', () => {
    seed(); lanes(); blockNow();
    for (const ago of [3000, 2000, 1000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> claude [home=claude]`);
    tick(STALLED, null); tick(STALLED, null);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('chain');
    expect(logLines('rescuewait')).toHaveLength(1);
  });

  it('the chain wait holds on the transcript rung\'s cached tick too — the dated row is read there', () => {
    seed(); lanes(); blockNow();
    threeFrom('claude-d');
    tick(PROMPT, null); tick(PROMPT, null);
    expect(h.reg(ID, 'tscan')).toMatch(/^\d+ 1$/);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'state')).toBe('open');
  });

  it('after RESCUE_CHAIN_WAIT the chain wait swaps — to a target that is not the account it just left blocked', () => {
    seed(); lanes(); blockNow();
    threeFrom('claude-a');
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=$(( $(date +%s) - 1801 )) reset=- wrapper=claude"`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-b`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('an ARMED chain wait whose account resets inside it ends in place and does not swap', () => {
    seed(); lanes(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 1000, R, 'five_hour')]);
    threeFrom('claude-d');
    openWait('chain', t - 1000, R);
    tick(ARMED, null);
    expect(dispatches()).toEqual([]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
  });

  it('a STALLED chain wait whose account reset ends turned and the tick rescues, with no second chain wait', () => {
    seed(); lanes(); const t = now(); const R = t - 200;
    writeTranscript([limitRow(t - 1000, R, 'five_hour')]);
    threeFrom('claude-a');
    openWait('chain', t - 1000, R);
    tick(STALLED, null);
    expect(dispatches(), 'claude-a is the account it just left blocked').toEqual([`dispatch ${ID} -> claude-b`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('turned');
    expect(logLines('rescuewait'), 'a second chain wait opened on the reset that just turned').toHaveLength(0);
  });

  it('a chain wait at its bound with no target that has room becomes the no-room wait', () => {
    seed(); blockNow();
    threeFrom('claude-d');
    h.sh(`_reg_set ${ID} rescuewait "state=open kind=chain since=$(( $(date +%s) - 1801 )) reset=- wrapper=claude"`);
    tick(STALLED, ''); tick(STALLED, '');
    expect(dispatches()).toEqual([]);
    expect(logLines('rescuewait-end'), 'the no-room wait flapped back into a chain wait').toHaveLength(1);
    expect(logLines('rescuewait-end')[0]).toContain('kind=chain');
    expect(logLines('rescuewait-end')[0]).toContain('end=noroom');
    expect(field(h.reg(ID, 'rescuewait'), 'kind')).toBe('noroom');
  });

  it('the home-return branch honours the skip too: a session rescued off its home is not sent straight back', () => {
    seed('claude-b'); lanes(); blockNow();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude.json'),
      JSON.stringify({ five: 10, seven: 5, ts: now() }));            // telemetry lags: home "looks" fine
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'),
      JSON.stringify({ five: 100, seven: 5, ts: now() }));
    pastLog(900, `auto-rescue ${ID}: claude (blocked) -> claude-b [home=claude]`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('spread never passes over HOME: a recovered home another session was rescued onto minutes ago is still where the rescue goes', () => {
    seed('claude-b'); lanes(); const t = now();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude.json'), JSON.stringify({ five: 10, seven: 5, ts: t }));
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'), JSON.stringify({ five: 100, seven: 5, ts: t }));
    blockNow();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude [home=claude]');
    tick(STALLED, null);
    expect(dispatches(), 'a third account first, then the affinity path home: two moves for one').toEqual([`dispatch ${ID} -> claude`]);
  });

  it('an unreadable swap log is today\'s behaviour: no chain wait, no skip', () => {
    seed(); lanes(); blockNow();
    fs.mkdirSync(regFile('swap.log'));
    tick(STALLED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
  });

  it('a tail with no rescue in it is a MEASURED empty history (rc 0); a log nobody can read is not (rc 2)', () => {
    seed();
    pastLog(60, 'swap other-sess: claude -> claude-a (uuid u1)');
    expect(h.sh(`_rescue_history ${ID}; echo "rc=$? $RESCUE_COUNT|$RESCUE_SKIP_LEFT|$RESCUE_SKIP_RECENT"`)).toBe('rc=0 0||');
    fs.rmSync(regFile('swap.log')); fs.mkdirSync(regFile('swap.log'));
    expect(h.sh(`_rescue_history ${ID}; echo "rc=$?"`)).toBe('rc=2');
  });

  it('a NON-rescue tick is `_swap_target` byte for byte: no skip list reaches the affinity path', () => {
    seed();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    const out = h.sh(`_swap_target() { echo "skip=[\${SWAP_TARGET_SKIP:-}]"; }; _rescue_target ${ID} claude claude '' 0`);
    expect(out).toBe('skip=[]');
  });

  it('nowhere to go is `_swap_target` byte for byte, and reads no swap log — a strand is asked every tick', () => {
    seed();
    const out = h.sh(`_swap_target() { return 1; }; _rescue_history() { echo history-read >> "$HOME/ccd-calls"; return 0; };
      out=$(_rescue_target ${ID} claude claude 1 0); echo "[$out] rc=$?"`);
    expect(out).toBe('[] rc=1');
    expect(h.calls()).not.toContain('history-read');
  });

  it('spread never buys a class degrade: a first-pass rc 6 falls through to the just-left-only pass', () => {
    seed();
    // claude-a is the only same-class target with room, and a rescue landed on
    // it minutes ago; with it skipped, `_swap_target` degrades onto claude-d.
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    const out = h.sh(`_swap_target() { if [[ " \${SWAP_TARGET_SKIP:-} " == *" claude-a "* ]]; then echo claude-d; return 6; fi; echo claude-a; return 0; };
      out=$(_rescue_target ${ID} claude claude 1 0); echo "$out rc=$?"`);
    expect(out).toBe('claude-a rc=0');
  });

  it('spread never turns a rescue undecidable: a spread-pass rc 5 falls through to the just-left-only pass', () => {
    seed();
    pastLog(120, 'auto-rescue other-sess: claude-d (blocked) -> claude-a [home=claude-d]');
    const out = h.sh(`_swap_target() { if [[ " \${SWAP_TARGET_SKIP:-} " == *" claude-a "* ]]; then return 5; fi; echo claude-a; return 0; };
      out=$(_rescue_target ${ID} claude claude 1 0); echo "$out rc=$?"`);
    expect(out).toBe('claude-a rc=0');
  });

  it('…end to end: the recent target is the only measured lane with room and another lane is unmeasured — rescued, not marked undecidable', () => {
    seed(); lanes(); const t = now();
    blockNow();
    fs.writeFileSync(path.join(h.home, '.cc-limits', 'claude-b.json'), JSON.stringify({ five: 100, seven: 5, ts: t }));
    pastLog(120, 'auto-rescue other-sess: claude-b (blocked) -> claude-a [home=claude-b]');
    // The class window is unmeasured on claude-d alone (`_class_gate` rc 2).
    h.sh(`${STUBS(STALLED, null)} _route_peek() { [[ "$2" == class ]] && echo opus; return 0; };
      _class_gate() { [[ -z "\${2:-}" ]] && return 0; [[ "$1" == claude-d ]] && return 2; return 0; };
      _auto_swap_check ${ID}`, BORN());
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'tickstuck')).toBeNull();
    expect(fs.existsSync(regFile(`${ID}.stranded`))).toBe(false);
  });

  it('a Codex-lane session on its fourth rescue in the hour is rescued at once, and its exclusion is written', () => {
    seed('gpt'); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    for (const ago of [3000, 2000, 1000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> gpt [home=claude]`);
    tick(PROMPT, 'claude-a');
    expect(dispatches()).toHaveLength(1);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(fs.existsSync(path.join(h.home, '.cc-limits', 'gpt.json')), 'the lane\'s "pool is full" signal').toBe(true);
  });

  it('an auth-failure pane is never chain-waited — lost auth has no reset to wait for', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]);
    threeFrom('claude-d');
    tick(AUTH);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toHaveLength(1);
  });

  it('a 401 only the transcript shows is never chain-waited either (D-3522)', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 100, t + 9000, 'five_hour'), authRow(t - 5)]);
    threeFrom('claude-d');
    tick(PROMPT);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toHaveLength(1);
  });

  it('a pane positive the transcript cannot date is never chain-waited — no dated row, no wait of any kind', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 300, t + 9000, 'five_hour'), turn(t - 30)]);
    threeFrom('claude-d');
    tick(STALLED);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
    expect(dispatches()).toHaveLength(1);
  });

  it('a 401 arriving during an open chain wait is rescued at once', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 100, t + 9000, 'five_hour'), authRow(t - 5)]);
    threeFrom('claude-d');
    openWait('chain', t - 60, t + 9000);
    tick(PROMPT);
    expect(dispatches()).toHaveLength(1);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  it('a torn chain record is never evaluated, and does not hold (D-299)', () => {
    seed(); blockNow();
    threeFrom('claude-d');
    const marker = path.join(h.home, 'evaluated');
    h.sh(`_reg_set ${ID} rescuewait 'state=open kind=chain since=REG[$(touch ${marker})] reset=- wrapper=claude'`);
    tick(STALLED);
    expect(fs.existsSync(marker)).toBe(false);
    expect(dispatches()).toHaveLength(1);
  });

  it('no chain wait opens on a five-hour reset whose grace has passed: the fourth rescue in the hour goes at once', () => {
    seed(); lanes(); const t = now(); const R = t - 3000;
    writeTranscript([limitRow(t - 5000, R, 'five_hour')]);
    for (const ago of [3000, 2500, 2000]) pastLog(ago, `auto-rescue ${ID}: claude-d (blocked) -> claude [home=claude]`);
    tick(ARMED, null); tick(ARMED, null);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(h.reg(ID, 'rescuewait')).toBeNull();
  });

  it('an open chain wait taken on ANOTHER account does not hold this one', () => {
    seed(); const t = now();
    writeTranscript([limitRow(t - 5, t + 300000, 'seven_day')]);
    openWait('chain', t - 60, '-', 'claude-b');
    tick(STALLED);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(field(h.reg(ID, 'rescuewait'), 'end')).toBe('swap');
  });

  // D-3526's never-came-up landing: its row is carried in (rc 3), kept a block,
  // and dates nothing — but the rescue line still names the row, so §9's
  // "rescues on a carried-in banner" stays countable.
  it('a rescue of a landing that never came up names its carried row= and no reset= or type=', () => {
    seed(); const t = now(); const born = t - 990;
    writeTranscript([limitRow(t - 3000, t + 300, 'five_hour')]);
    h.sh(`_reg_set ${ID} lastswap ${t - 1000}; _reg_set ${ID} spawn "${born + 30} 4"`);
    tick(ARMED, 'claude-a', { TMUX_CREATED: String(born) });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a`]);
    expect(logLines('auto-rescue')[0]).toMatch(new RegExp(`\\[home=claude\\] row=${t - 3000}$`));
    expect(h.sh(`_hard_block_date 3 5 100; echo "$HARD_BLOCK_RESET|$HARD_BLOCK_TYPE|$HARD_BLOCK_ROW"`)).toBe('||100');
  });
});

// ── THE DO-NOT-BOUNCE STRAND SAYS SO (departure 3849, the coordinator's ruling (B)) ──
// "No account in the pool has room" and "the only account with room is one this
// session just left blocked" ask the operator for opposite acts — wait or add
// capacity, versus leave it alone — so the strand's marker, swap.log line and
// banner must not say the first when the second is true (no overloaded null at
// a seam). `_rescue_strand_cause` asks `_swap_target` UNSKIPPED, on the
// no-target strand path only, and names a cause only when that answer is an
// account rule 3 skipped as just left; otherwise `_strand_mark` keeps its own
// computed reason, as today.
describe('the do-not-bounce strand names the account it will not take back', () => {
  const fill = (lanes: Record<string, number>): void => {
    const t = now();
    for (const [w, five] of Object.entries(lanes)) {
      fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
        JSON.stringify({ five, seven: 5, ts: t, fiveResetAt: t + 10000, sevenResetAt: t + 400000 }));
    }
  };
  const plantNotify = (): void => {
    fs.writeFileSync(regFile('notify.sh'), '#!/bin/sh\nprintf \'%s\\n\' "$1" >> "$HOME/notify-log"\n', { mode: 0o755 });
  };
  const notified = (): string => (fs.existsSync(path.join(h.home, 'notify-log')) ? fs.readFileSync(path.join(h.home, 'notify-log'), 'utf8') : '');
  const blockNow = (): void => { const t = now(); writeTranscript([limitRow(t - 5, t + 9000, 'five_hour')]); };
  /** `_rescue_history` counted: each call logs, then runs the real one. */
  const COUNTED = `eval "$(declare -f _rescue_history | sed '1s/^_rescue_history/_rh_real/')";
    _rescue_history() { echo history-read >> "$HOME/ccd-calls"; _rh_real "$@"; };`;

  it('the only account with room is the one just left blocked: marker, swap.log and banner name it and say do not bounce', () => {
    seed(); plantNotify(); blockNow();
    fill({ claude: 100, 'claude-a': 10, 'claude-b': 100, 'claude-d': 100 });
    pastLog(900, `auto-rescue ${ID}: claude-a (blocked) -> claude [home=claude]`);
    tick(STALLED, null);
    expect(dispatches()).toEqual([]);
    const marker = fs.readFileSync(regFile(`${ID}.stranded`), 'utf8');
    expect(marker).toMatch(/claude-a/);
    expect(marker).toMatch(/do not bounce/);
    const line = swapLog().split('\n').find((l) => l.includes(` stranded ${ID}: `)) ?? '';
    expect(line).toMatch(/claude-a.*do not bounce/);
    expect(notified()).toMatch(new RegExp(`STRANDED: ${ID} is blocked on claude — .*claude-a.*do not bounce`));
    expect(notified(), 'the false sentence').not.toMatch(/can take it/);
  });

  it('control: a genuine no-room strand reads as today, and its later ticks read no swap log', () => {
    seed(); plantNotify(); blockNow();
    fill({ claude: 100, 'claude-a': 100, 'claude-b': 100, 'claude-d': 100 });
    tick(STALLED, null);
    expect(dispatches()).toEqual([]);
    expect(notified()).toMatch(new RegExp(`STRANDED: ${ID} is blocked on claude and no account in pool \\(untagged\\) can take it`));
    expect(fs.readFileSync(regFile(`${ID}.stranded`), 'utf8')).not.toMatch(/do not bounce/);
    fs.rmSync(path.join(h.home, 'ccd-calls'), { force: true });
    h.sh(`${STUBS(STALLED, null)} ${COUNTED} _auto_swap_check ${ID}`, BORN());
    expect(h.calls().filter((l) => l === 'history-read'), 'a stranded tick paid the swap-log read').toEqual([]);
  });

  it('_rescue_strand_cause names an account only when rule 3 skipped it as just left', () => {
    const ask = (probe: string, left: string): string => h.sh(`_swap_target() { [[ -n "${probe}" ]] && echo "${probe}"; return 0; };
      _rescue_history() { RESCUE_COUNT=1 RESCUE_SKIP_LEFT="${left}" RESCUE_SKIP_RECENT=""; return 0; };
      out=$(_rescue_strand_cause ${ID} claude claude 1 0); echo "$?|$out"`);
    expect(ask('claude-a', 'claude-a')).toMatch(/^0\|.*claude-a.*do not bounce/);
    expect(ask('claude-b', 'claude-a'), 'room the skip did not remove').toBe('1|');
    expect(ask('', 'claude-a'), 'no room at all').toBe('1|');
    expect(ask('claude', 'claude'), 'the account it sits on').toBe('1|');
  });
});
