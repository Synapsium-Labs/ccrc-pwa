// A pane narrower than the reader width still gets the transcript rung (D-8123, limit-swap-autofix Task 5).
//
// `_pane_measurable` answers 1 for a pane under READER_MIN_COLS: a wrapped phrase reads as idle, so every PANE rung
// stands down (spec section 6.3). Before this change `_session_hard_blocked` stood down whole and `_auto_swap_check`
// returned at its top, so a session on a narrow pane that hit a limit was never rescued, however loud its transcript
// was. The transcript is not wrapped by the terminal: its newest real row is this process's limit row or it is not.
// So on a narrow pane `_session_hard_blocked` skips the two pane rungs and the `esc to interrupt` test, runs the
// stale-press grace and the transcript rung as on a wide pane, and keeps the box read's `draft` stand-down. It answers
// `HARD_BLOCK_NO=unmeasurable` when the transcript says nothing. `_auto_swap_check` asks it first on a narrow pane: a
// positive verdict takes the rescue path (which never reaches the affinity arm), a negative one keeps the narrow note.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). tmux answers one pane from `$HOME/pane.txt`, and `narrow` in HOME makes the
// width query answer 80. `_dispatch_swap` logs. Neutral ids: the session `lane-a-project-a`, the fixture roster's
// wrappers. Nothing here reaches a real pane, and no case may send a key.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-narrow-transcript-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000e5';
const PID = '4242';
const T0 = Math.floor(Date.now() / 1000);
const iso = (epoch: number): string => new Date(epoch * 1000).toISOString();

const seed = (): void => {
  h.sh(`_reg_set ${ID} wrapper claude
        _reg_set ${ID} home claude
        _reg_set ${ID} project project-a
        _reg_set ${ID} workdir "$HOME/projects/project-a"
        _reg_set ${ID} uuid ${UUID}
        _reg_set ${ID} started 1`);
  fs.mkdirSync(path.join(h.home, 'projects', 'project-a'), { recursive: true });
  fs.mkdirSync(path.join(h.home, '.cc-limits'), { recursive: true });
  for (const [w, five] of [['claude', 100], ['claude-a', 10]] as const) {
    fs.writeFileSync(path.join(h.home, '.cc-limits', `${w}.json`),
      JSON.stringify({ five, seven: 5, ts: T0, fiveResetAt: T0 + 10000, sevenResetAt: T0 + 400000 }));
  }
};
const narrow = (): void => { fs.writeFileSync(path.join(h.home, 'narrow'), ''); };

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
const writeTranscript = (lines: string[]): void => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
};

const BORDER = '────────────────────────────';
const PROMPT = `${BORDER}\n❯ \n${BORDER}\n  ? for shortcuts`;
const DRAFT = `${BORDER}\n❯ a half-typed reply\n${BORDER}\n  ? for shortcuts`;
const BANNER = `You've hit your session limit · resets 9:10pm (UTC)\n${PROMPT}`;
const BUSY = `✻ Working… (12s · esc to interrupt)\n${PROMPT}`;

const STUBS = (pane: string): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), pane + '\n');
  return `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) [[ -e "$HOME/narrow" ]] && { echo "1 80"; return 0; }; echo "1 200"; return 0 ;; esac
    case "\${1:-}" in
      capture-pane) cat "$HOME/pane.txt" ;; list-panes) echo ${PID} ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2 $3" >> "$HOME/ccd-calls"; };`;
};
const env = (born = T0 - 86400): Record<string, string> => ({ TMUX_CREATED: String(born), FAKE_NOW: String(T0) });
const tick = (pane: string, extra = ''): void => {
  h.sh(`${STUBS(pane)} ${extra} _auto_swap_check ${ID}`, env());
};
const verdict = (pane: string): string =>
  h.sh(`${STUBS(pane)} _session_hard_blocked ${ID} ${JSON.stringify(pane)}; echo "$?|$HARD_BLOCK_NO|$HARD_BLOCK_VIA"`, env());
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const keystrokes = (): string[] => h.calls().filter((l) => l.startsWith('tmux send-keys'));

describe('a narrow pane gets the transcript rung', () => {
  it('a narrow pane whose transcript ends in this process\'s limit row is rescued via=transcript', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(PROMPT);
    expect(lines('auto-rescue')).toEqual([expect.stringMatching(/ via=transcript /)]);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(lines('swap-skip')).toEqual([]);
    expect(keystrokes()).toEqual([]);
  });

  it('a narrow pane with a draft stands down `draft`, no move', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    tick(DRAFT);
    expect(lines('stand-down').join('\n')).toMatch(/stand-down lane-a-project-a: draft evidence=transcript/);
    expect(lines('auto-rescue')).toEqual([]);
    expect(dispatches()).toEqual([]);
    expect(keystrokes()).toEqual([]);
  });

  it('kept: a narrow pane with no limit row writes the narrow note and moves nothing', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60)]);
    tick(PROMPT);
    expect(lines('swap-skip')).toEqual([expect.stringMatching(/swap-skip lane-a-project-a: pane is under \d+ columns/)]);
    expect(lines('auto-rescue')).toEqual([]);
    expect(dispatches()).toEqual([]);
  });

  it('kept: a narrow pane never reaches the affinity arm, whatever the telemetry says', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60)]);
    // home is at its ceiling and claude-a has room: on a wide idle pane this would be an affinity move
    tick(PROMPT, '_avail() { [[ "$1" != claude ]]; };');
    expect(lines('auto-home')).toEqual([]);
    expect(lines('auto-rescue')).toEqual([]);
    expect(dispatches()).toEqual([]);
  });
});

describe('the pane rungs stay off on a narrow pane', () => {
  it('a limit banner in a narrow pane with nothing in the transcript is not a verdict (a wrapped phrase is not read)', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60)]);
    tick(BANNER);
    expect(lines('auto-rescue')).toEqual([]);
    expect(dispatches()).toEqual([]);
    expect(verdict(BANNER)).toBe('1|unmeasurable|');
  });

  it('control: the same banner on a wide pane is a pane verdict', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    expect(verdict(BANNER)).toMatch(/^0\|\|(pane|banner)$/);
  });

  it('a narrow pane showing `esc to interrupt` does not suppress the transcript rung', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    expect(verdict(BUSY)).toBe('0||transcript');
  });
});

describe('_session_hard_blocked on a narrow pane', () => {
  it('the transcript says nothing: unmeasurable, as before', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60)]);
    expect(verdict(PROMPT)).toBe('1|unmeasurable|');
  });

  it('the transcript ends in this process\'s limit row: blocked, via=transcript', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    expect(verdict(PROMPT)).toBe('0||transcript');
  });

  it('a draft in the box: no, `draft`', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    expect(verdict(DRAFT)).toBe('1|draft|');
  });

  it('a fresh stale-press stamp: no, `stalepress` (the grace is not narrow-specific)', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60), limitRow(T0 - 5)]);
    h.sh(`_reg_set ${ID} stalepress ${T0 - 2}`);
    expect(verdict(PROMPT)).toBe('1|stalepress|');
  });

  it('a limit row carried in from before this process: still no, never unmeasurable-but-blocked', () => {
    seed(); narrow(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    const out = h.sh(`${STUBS(PROMPT)} _session_hard_blocked ${ID} ${JSON.stringify(PROMPT)}; echo "$?|$HARD_BLOCK_NO"`, env(T0 - 1900));
    expect(out).toBe('1|carried-in');
  });

  it('a negative transcript on a narrow pane is not a measured negative: the act gate does not cancel a rescue on it', () => {
    seed(); narrow(); writeTranscript([turn(T0 - 60)]);
    const out = h.sh(`${STUBS(PROMPT)} _swap_rescue_act_gate ${ID} claude; echo "rc=$?"`, env());
    expect(out).toBe('rc=0');
    expect(lines('rescue-cancel')).toEqual([]);
  });
});
