// The limit menu: read the whole pane for its banner and bypass the verdict cache (D-8123, limit-swap-autofix Task 6).
//
// When a limit lands, Claude Code opens its rate-limit menu ("What do you want to do?") by itself, and the menu pushes
// the banner above it out of the tick's `tail -8`. Before this change the pane rungs then saw only the menu, and the
// verdict fell to the transcript rung, whose answer is cached for TRANSCRIPT_ARM_INTERVAL (30 s). So a session could sit
// on its menu for half a minute with the banner on screen. Now `_pane_limit_menu` recognises the menu,
// `_pane_limit_capture_to` returns the whole visible pane only while the menu is up (one extra `capture-pane -p`, paid
// only when the tail shows the menu's footer or question), `_session_hard_blocked` asks `_pane_limit_banner` of that
// capture, and the `.tscan` cached verdict is not reused while the menu is up. The broad `_pane_hard_blocked` stays on
// the tail, so conversation text cannot trigger it. Nothing here ever sends a key: the rescue ends the session and
// resumes it on another account.
//
// FIXTURE HOME ONLY (`makeCcdHarness`). tmux answers one pane from `$HOME/pane.txt` (plain, for `-p`) and
// `$HOME/pane.ansi` (raw, for `-e`) and logs every call to `$HOME/ccd-calls`; `_dispatch_swap` logs. Neutral ids: the
// session `lane-a-project-a`, the fixture roster's wrappers. The committed dialog fixtures are the real renders.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-limit-menu-detect-'); });
afterEach(() => { h.cleanup(); });

const ID = 'lane-a-project-a';
const UUID = 'a0000000-0000-4000-8000-0000000000f6';
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
const writeTranscript = (lines: string[]): string => {
  const p = h.sh(`_transcript_path ${ID}`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
};

const fixture = (name: string): string =>
  fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'panes', 'box', name), 'utf8');
// eslint-disable-next-line no-control-regex
const plain = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '');
const MENU_FIXTURE = fixture('rate-limit-dialog.ansi');
const MENU_MAIL_FIXTURE = fixture('rate-limit-dialog-mail-row.ansi');
/** The menu alone: no banner anywhere on the pane (a menu opened after the banner scrolled away). */
const MENU_WITHOUT_BANNER = [
  '', '─────────────────────────────', '  What do you want to do?', '',
  '  ❯ 1. Stop and wait for limit to reset', '    2. Upgrade your plan', '    3. Switch to usage credits',
  '    4. Wait here, then continue automatically after reset', '', '  Enter to confirm · Esc to cancel',
].join('\n');
const BORDER = '────────────────────────────';
const PROMPT = `${BORDER}\n❯ \n${BORDER}\n  ? for shortcuts`;
const BANNER_LINE = "  ⎿  You've hit your weekly limit · resets Nov 9, 11pm (UTC)";
/** A banner-shaped line the conversation printed 20 rows up, then an ordinary idle prompt: no menu. */
const BANNER_IN_CONVERSATION = `${BANNER_LINE}\n${Array.from({ length: 20 }, (_, i) => `  line ${i}`).join('\n')}\n${PROMPT}`;

/** The text as a bash word: written to a file so its newlines and quotes reach the function intact. */
let textN = 0;
const word = (text: string): string => {
  const f = path.join(h.home, `text-${textN++}.txt`);
  fs.writeFileSync(f, text);
  return `"$(cat ${JSON.stringify(f)})"`;
};

const STUBS = (pane: string): string => {
  fs.writeFileSync(path.join(h.home, 'pane.txt'), plain(pane) + '\n');
  fs.writeFileSync(path.join(h.home, 'pane.ansi'), pane + '\n');
  return `
  date() { if [[ "\${1:-}" == +%s && -n "\${FAKE_NOW:-}" ]]; then echo "$FAKE_NOW"; else command date "$@"; fi; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls"
    case "$*" in *pane_active*) echo "1 200"; return 0 ;; esac
    case "\${1:-}" in
      capture-pane) case "$*" in *" -e"*) cat "$HOME/pane.ansi" ;; *) cat "$HOME/pane.txt" ;; esac ;;
      list-panes) echo ${PID} ;;
      display-message) [ -n "\${TMUX_CREATED:-}" ] && echo "$TMUX_CREATED" ;; esac; return 0; };
  _dispatch_swap() { echo "dispatch $1 -> $2 $3" >> "$HOME/ccd-calls"; };`;
};
const env = (born = T0 - 86400): Record<string, string> => ({ TMUX_CREATED: String(born), FAKE_NOW: String(T0) });
/** `_auto_swap_check` on this pane, the real `_swap_target`. `tail` is what the tick itself reads: tail -8 of the pane. */
const tick = (pane: string, born?: number): void => {
  h.sh(`${STUBS(pane)} _auto_swap_check ${ID}`, env(born));
};
const verdict = (pane: string, born?: number): string =>
  h.sh(`${STUBS(pane)} _session_hard_blocked ${ID} "$(tail -n 8 "$HOME/pane.txt")"; echo "$?|$HARD_BLOCK_NO|$HARD_BLOCK_VIA"`, env(born));
const regFile = (f: string): string => path.join(h.home, '.cc-sessions', f);
const swapLog = (): string => (fs.existsSync(regFile('swap.log')) ? fs.readFileSync(regFile('swap.log'), 'utf8') : '');
const lines = (word: string): string[] => swapLog().split('\n').filter((l) => l.includes(` ${word} `));
const dispatches = (): string[] => h.calls().filter((l) => l.startsWith('dispatch '));
const captures = (): string[] => h.calls().filter((l) => /^tmux capture-pane/.test(l));
const keystrokes = (): string[] => h.calls().filter((l) => /send-keys/.test(l));

describe('_pane_limit_menu: the rate-limit menu is the question row plus a numbered cursor row', () => {
  const menu = (text: string): string =>
    h.sh(`if _pane_limit_menu ${word(text)}; then echo yes; else echo no; fi`);

  it('both committed fixtures are the menu', () => {
    expect(menu(plain(MENU_FIXTURE))).toBe('yes');
    expect(menu(plain(MENU_MAIL_FIXTURE))).toBe('yes');
  });

  it('the cursor on "Switch to usage credits" is the menu too', () => {
    expect(menu('  What do you want to do?\n\n    1. Stop and wait for limit to reset\n  ❯ 3. Switch to usage credits')).toBe('yes');
  });

  it('the question row alone is not the menu', () => {
    expect(menu('  What do you want to do?\n\n  something else entirely')).toBe('no');
  });

  it('the cursor row alone, with no question row, is not the menu', () => {
    expect(menu('  ❯ 1. Stop and wait for limit to reset')).toBe('no');
  });

  it('a numbered cursor row naming some other option is not the menu', () => {
    expect(menu('  What do you want to do?\n\n  ❯ 1. Open the file')).toBe('no');
  });
});

describe('_pane_limit_capture_to: the whole pane only while the menu is up', () => {
  const capture = (pane: string, tail: string): string =>
    h.sh(`${STUBS(pane)} _pane_limit_capture_to out ${ID} ${word(tail)}; printf '%s' "$out"`, env());

  it('no menu footer or question in the tail: the tail comes back and no capture is paid', () => {
    const tail = `line\n${PROMPT}`;
    expect(capture(BANNER_IN_CONVERSATION, tail)).toBe(tail);
    expect(captures()).toEqual([]);
  });

  it('the menu footer in the tail: one capture, and the whole visible pane comes back', () => {
    const tail = plain(MENU_FIXTURE).split('\n').slice(-8).join('\n');
    const out = capture(MENU_FIXTURE, tail);
    expect(out).toContain("You've hit your weekly limit");
    expect(captures()).toHaveLength(1);
    expect(keystrokes()).toEqual([]);
  });

  it('the footer in the tail but no menu on the whole pane: the tail unchanged', () => {
    const tail = 'Enter to confirm · Esc to cancel';
    expect(capture(`some other dialog\n${tail}`, tail)).toBe(tail);
  });
});

describe('the whole-pane banner read', () => {
  it('the menu fixture: the banner above the menu is found, via=banner', () => {
    seed();
    tick(MENU_FIXTURE);   // today: no banner in tail -8, and no limit row in the transcript
    expect(lines('auto-rescue')).toEqual([expect.stringMatching(/ via=banner /)]);
    expect(dispatches()).toEqual([`dispatch ${ID} -> claude-a rescue`]);
    expect(keystrokes()).toEqual([]);
  });

  it('the mail-row fixture is found the same way', () => {
    seed();
    tick(MENU_MAIL_FIXTURE);
    expect(lines('auto-rescue')).toEqual([expect.stringMatching(/ via=banner /)]);
    expect(keystrokes()).toEqual([]);
  });

  it('kept: a banner-shaped line in the conversation, 20 rows up and no menu, is not a block', () => {
    seed(); writeTranscript([turn(T0 - 60)]);
    expect(verdict(BANNER_IN_CONVERSATION)).toBe('1|negative|');
    tick(BANNER_IN_CONVERSATION);
    expect(lines('auto-rescue')).toEqual([]);
    expect(dispatches()).toEqual([]);
    expect(captures().filter((l) => !/ -e/.test(l))).toHaveLength(1);   // the tick's own `-p` capture, nothing wider
  });

  it('a banner dated to an earlier process above the menu is still not a block (carried in)', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    expect(verdict(MENU_FIXTURE, T0 - 1900)).toBe('1|carried-in|');
  });
});

describe('the stand-down note reads past the tail', () => {
  it('a carried-in banner above the menu is noted with banner-outside-tail=yes, and nothing moves', () => {
    seed(); h.sh(`_reg_set ${ID} lastswap ${T0 - 2000}`);
    writeTranscript([limitRow(T0 - 3000)]);
    tick(MENU_FIXTURE, T0 - 1900);
    expect(lines('stand-down')).toContainEqual(expect.stringMatching(/stand-down lane-a-project-a: carried-in evidence=banner banner-outside-tail=yes$/));
    expect(dispatches()).toEqual([]);
    expect(keystrokes()).toEqual([]);
  });
});

describe('the verdict cache is bypassed while the menu is up', () => {
  it('menu up and a negative .tscan 5 s old: the transcript is rescanned, not reused', () => {
    seed(); h.sh(`_reg_set ${ID} tscan "${T0 - 5} 0"`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 3)]);
    tick(MENU_WITHOUT_BANNER);
    expect(lines('auto-rescue')).toEqual([expect.stringMatching(/ via=transcript /)]);
    expect(h.reg(ID, 'tscan')).toBe(`${T0} 1`);   // the fresh answer is still written back
    expect(keystrokes()).toEqual([]);
  });

  it('kept: no menu: a negative .tscan inside the interval is reused (no rescan)', () => {
    seed(); h.sh(`_reg_set ${ID} tscan "${T0 - 5} 0"`);
    writeTranscript([turn(T0 - 60), limitRow(T0 - 3)]);
    tick(PROMPT);
    expect(lines('auto-rescue')).toEqual([]);
    expect(h.reg(ID, 'tscan')).toBe(`${T0 - 5} 0`);
    expect(dispatches()).toEqual([]);
  });

  it('menu up and a silent transcript: not blocked, the scan is written back as 0', () => {
    seed(); h.sh(`_reg_set ${ID} tscan "${T0 - 5} 1"`);
    writeTranscript([turn(T0 - 60)]);
    expect(verdict(MENU_WITHOUT_BANNER)).toBe('1|negative|');
    expect(h.reg(ID, 'tscan')).toBe(`${T0} 0`);
  });
});

describe('the act gate reads the same capture', () => {
  const gate = (pane: string): string => {
    const tx = writeTranscript([turn(T0 - 60)]);
    return h.sh(`${STUBS(pane)} CCD_SWAP_TX=${JSON.stringify(tx)} CCD_SWAP_TX_BYTES=${fs.statSync(tx).size} _swap_rescue_act_gate ${ID} claude; echo "rc=$?"`, env());
  };

  it('the act gate with the menu up does not cancel the rescue', () => {
    seed();
    expect(gate(MENU_FIXTURE)).toBe('rc=0');   // today: no banner in tail -8, a negative, rescue-cancel
    expect(lines('rescue-cancel')).toEqual([]);
    expect(lines('rescue-backoff')).toEqual([]);
    expect(keystrokes()).toEqual([]);
  });

  it('kept: the act gate with no menu and no block still cancels', () => {
    seed();
    expect(gate(PROMPT)).toBe('rc=1');
    expect(lines('rescue-cancel')).toEqual([expect.stringMatching(/rescue-cancel lane-a-project-a: no longer blocked \(negative\)/)]);
  });
});

describe('no keys, whatever the menu shows', () => {
  it('sends no keys across every path', () => {
    seed(); writeTranscript([turn(T0 - 60), limitRow(T0 - 3)]);
    for (const pane of [MENU_FIXTURE, MENU_MAIL_FIXTURE, MENU_WITHOUT_BANNER, BANNER_IN_CONVERSATION]) tick(pane);
    expect(keystrokes()).toEqual([]);
  });
});
