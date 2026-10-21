// Every silent stand-down logged, once per episode, with a re-log floor
// (D-6180; auto-swap reliability spec §3.2, the operator's D5 ruling).
//
// `_auto_swap_check` holds a session in a dozen places and, before D-6180, said
// so in almost none of them (spec §2.5's table). This file pins what each of
// those places writes to `swap.log`. It changes no decision: every row that
// asserts a line also asserts the move (or the absence of one) is what it was.
//
// THE CHARACTERIZATION BLOCK comes first and was green on the base: "today:"
// rows are the ones D-6180's commits flip (each flipped row is rewritten in
// the commit that flips it and keeps its name), "kept:" rows must never move.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). tmux answers one pane from
// `$HOME/pane.txt` and, while `TMUX_CREATED` is set, the pane's
// `session_created`; `_dispatch_swap` logs; `_swap_target` and `_avail` are
// stubbed where a case is about the stand-down rather than the choice. The
// clock is ccd's own seam (`_now_s_to` falls back to `date +%s` when `date` is
// a function), driven by `FAKE_NOW`. Neutral ids throughout (public
// repository): the session `lane-a-project-a`, the fixture roster's wrappers.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness, WIDE_PANE } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-standdown-notes-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000d5';
const PID = '4242';
const T0 = Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

const seed = (wrapper = 'claude', home = 'claude'): void => {
  h.sh(`_reg_set ${ID} wrapper ${wrapper}
        _reg_set ${ID} home ${home}
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir "$HOME/projects/project-a"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'project-a'), { recursive: true });
};

/** Claude Code's 429 row (the `ccd-rescue-policy.test.ts` shape). */
const limitRow = (at: number): string => JSON.stringify({
  parentUuid: 'p', isSidechain: false, type: 'assistant', uuid: `b${at}`, timestamp: iso(at),
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 9:10pm (UTC)" }] },
  isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  quotaLimits: { status: 'rejected', resetsAt: at + 3600, rateLimitType: 'five_hour' },
});
const turn = (at: number): string => JSON.stringify({
  type: 'assistant', uuid: `a${at}`, timestamp: iso(at),
  message: { model: 'claude-opus-5', role: 'assistant', content: [{ type: 'text', text: 'Working on it.' }] },
});
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};

const BORDER = '────────────────────────────';
const PROMPT = '? for shortcuts\n❯ ';
const STALLED = "You've hit your session limit · resets 9:10pm (UTC)\n❯ ";
const BUSY = '✻ Working… (12s · esc to interrupt)\n❯ ';
const DRAFT = `${BORDER}\n❯ a half-typed reply\n${BORDER}\n  ? for shortcuts`;

/** tmux answers ONE pane for every capture; `narrow` in HOME makes the width
 *  query fail. `target` stubs `_swap_target` (null = leave it real). */
const STUBS = (pane: string, target: string | null = 'claude-a'): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) [[ -e "$HOME/narrow" ]] && { echo "1 80"; return 0; }; echo "1 200"; return 0 ;; esac
    case "\${1:-}" in
      capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo ${PID} ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  ${target === null ? '' : `_swap_target() { [[ -n ${JSON.stringify(target)} ]] && echo ${JSON.stringify(target)}; return 0; };`}
  _dispatch_swap() { echo "dispatch $1 -> $2 $3" >> "$HOME/ccd-calls"; };`;
};
/** The pane's process was born a day before T0 unless a case says not. */
const env = (now = T0, born = T0 - 86400): Record<string, string> => ({ TMUX_CREATED: String(born), FAKE_NOW: String(now) });
const tick = (pane: string, opts: { target?: string | null; now?: number; born?: number; extra?: string } = {}): void => {
  h.sh(`${STUBS(pane, opts.target === undefined ? 'claude-a' : opts.target)} ${opts.extra ?? ''} _auto_swap_check ${ID}`,
    env(opts.now, opts.born));
};
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));

/** The affinity arm, every gate open: a clean prompt, an idle status file far
 *  older than SWAP_CEIL_QUIET, a target other than cur, `_avail` passing. */
const idleStatus = (wrapper = 'claude'): void => {
  const dir = path.join(h.home, wrapper === 'claude' ? '.claude' : `.${wrapper}`, 'sessions');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${PID}.json`), JSON.stringify({ status: 'idle', statusUpdatedAt: 1 }));
};
const AFFINITY = '_avail() { return 0; };';

// ── CHARACTERIZATION ─────────────────────────────────────────────────────────

describe('characterization: what each silent exit writes today', () => {
  it('today: a session in SWAP_COOLDOWN whose newest transcript row is this process\'s limit row writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(PROMPT);
    expect(swapLog()).toBe('');
    expect(dispatches()).toEqual([]);
  });

  it('today: the same in SWAPBLOCK_COOLDOWN writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} swapblocked "${T0 - 100} refused"`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(PROMPT);
    expect(swapLog()).toBe('');
    expect(dispatches()).toEqual([]);
  });

  it('today: a draft stand-down over a limit row writes nothing', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(DRAFT, { target: '' });
    expect(swapLog()).toBe('');
    expect(dispatches()).toEqual([]);
  });

  it('today: a carried-in transcript row caches as 0 and reads negative', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    const out = h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "$?|$HARD_BLOCK_NO"`, env(T0, T0 - 1900));
    expect(out).toBe('1|negative');
    expect(h.reg(ID, 'tscan')).toBe(`${T0} 0`);
  });

  it('today: the rescue\'s dropped target writes nothing', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: '_avail() { return 1; };' });
    expect(swapLog()).toBe('');
    expect(dispatches()).toEqual([]);
  });

  it('today: an affinity move held by .hold writes nothing', () => {
    seed(); idleStatus(); writeTranscript([turn(T0 - 60)]);
    fs.writeFileSync(regFile(`${ID}.hold`), 'program:demo wave:1/1 run:1');
    tick(PROMPT, { extra: AFFINITY });
    expect(swapLog()).toBe('');
    expect(dispatches()).toEqual([]);
  });

  it('today: an auto-rescue line ends at its [home=…]/via= suffix', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: AFFINITY });
    expect(swapLog()).toMatch(/auto-rescue lane-a-project-a: claude \(blocked\) -> claude-a \[home=claude\]( via=\S+)?( reset=\S+)?( type=\S+)?( row=\S+)?$/m);
  });

  it('kept: a session in cooldown with no limit row writes nothing', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 100}`);
    writeTranscript([turn(T0 - 60)]);
    tick(PROMPT);
    expect(swapLog()).toBe('');
    expect(dispatches()).toEqual([]);
  });

  it('kept: the rescue dispatches on the same tick it detects', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(STALLED, { extra: AFFINITY });
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(lines('auto-rescue')).toHaveLength(1);
  });

  it('kept: pin-hold\'s floored note is unchanged', () => {
    seed('claude-a', 'claude'); idleStatus('claude-a'); writeTranscript([turn(T0 - 60)]);
    h.sh(`_reg_set ${ID} swappin claude-a`);
    tick(PROMPT, { target: 'claude', extra: AFFINITY });
    tick(PROMPT, { target: 'claude', extra: AFFINITY, now: T0 + 60 });
    expect(lines('pin-hold')).toEqual([
      expect.stringMatching(/pin-hold lane-a-project-a: pinned to claude-a by hand; the return-home\/ceiling arm stands down \(a limit still evacuates\)$/),
    ]);
    expect(dispatches()).toEqual([]);
  });

  it('kept: _pane_narrow_note writes at most once per floor', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    fs.writeFileSync(path.join(h.home, 'narrow'), '');
    tick(PROMPT);
    tick(PROMPT, { now: T0 + 600 });
    expect(lines('swap-skip')).toHaveLength(1);
    expect(lines('swap-skip')[0]).toMatch(/swap-skip lane-a-project-a: pane is under \d+ columns/);
    expect(dispatches()).toEqual([]);
  });

  it('kept: a busy session at home writes nothing', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    tick(BUSY, { target: '' });
    expect(swapLog()).toBe('');
  });
});
