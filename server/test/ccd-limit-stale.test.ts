import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-limit-stale-'); });
afterEach(() => { h.cleanup(); });

const ID = 'myid';
const STUBS = `sleep() { :; };
  tmux() { echo "tmux $*" >> "$HOME/ccd-calls";
    case "\${1:-}" in capture-pane) printf '%s\\n' "\${PANE_TEXT:-}" ;; esac; return 0; };
  _pane_box_draft() { printf '%s' "\${BOX_DRAFT:-}"; };`;
/** The bundle's own sentence for `phase:"stale"` (2.1.267, `mu(l)`): what the
 *  status line shows when Claude Code slept through its own reset. */
const STALE = 'Your usage limit has reset · press enter to continue\n❯ ';
const STALE_WITH_CONTINUATION_DRAFT = 'Your usage limit has reset · press enter to continue\n❯ \n  half a sentence\n────────────────────────\n  👤 team·max';
const STALE_NO_PROMPT = 'Your usage limit has reset · press enter to continue\n';
const ARMED = 'Usage limit reached · continuing automatically at 11:50am · esc or type to cancel\n❯ ';
const BUSY = 'Your usage limit has reset · press enter to continue\nWorking… (esc to interrupt)\n❯ ';
const READY = '? for shortcuts\n❯ ';
const seed = (): void => { h.sh(`_reg_set ${ID} wrapper claude`); };
const enters = (): string[] => h.calls().filter((l) => l === `tmux send-keys -t cc-${ID} Enter`);
const swapLog = (): string => {
  const f = path.join(h.home, '.cc-sessions', 'swap.log');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const stamp = (): string => h.sh(`_reg_get ${ID} stalepress`);
const check = (env: Record<string, string> = {}): void => { h.sh(`${STUBS} _auto_stale_check ${ID}`, { PANE_TEXT: STALE, ...env }); };

describe('_pane_limit_stale', () => {
  it.each([
    ['Your usage limit has reset · press enter to continue', true],
    ['your usage limit has reset · Press Enter to continue', true],
    ['Usage limit reached · continuing automatically at 11:50am · esc or type to cancel', false],
    ["You've hit your session limit · resets 11:50am (UTC)", false],
    ['press enter to continue', false],
    ['? for shortcuts', false],
  ])('%s -> %s', (pane, stale) => {
    expect(h.sh(`_pane_limit_stale ${JSON.stringify(pane)} && echo yes || echo no`)).toBe(stale ? 'yes' : 'no');
  });
});

describe('_auto_stale_check presses Enter for a stale auto-continue (D-2360)', () => {
  it('one Enter, a stale-resume line, and a stamp', () => {
    seed(); check();
    expect(enters()).toHaveLength(1);
    expect(swapLog()).toMatch(/stale-resume myid: usage limit has reset; pressing Enter .*\[wrapper=claude\]/);
    expect(stamp()).toMatch(/^[0-9]+$/);
  });
  it('not again within STALE_PRESS_COOLDOWN', () => {
    seed(); check(); check();
    expect(enters()).toHaveLength(1);
  });
  it('a 60-second-old stamp is still inside the 120-second cooldown', () => {
    seed(); h.sh(`_reg_set ${ID} stalepress $(( $(date +%s) - 60 ))`); check();
    expect(enters()).toEqual([]);
  });
  it('a 121-second-old stamp is outside the 120-second cooldown', () => {
    seed(); h.sh(`_reg_set ${ID} stalepress $(( $(date +%s) - 121 ))`); check();
    expect(enters()).toHaveLength(1);
  });
  it('again once the cooldown has lapsed', () => {
    seed(); check(); h.sh(`_reg_set ${ID} stalepress 1`); check();
    expect(enters()).toHaveLength(2);
  });
  it('a non-empty input box: no keystroke, a stale-skip line, and the stamp so the line is not repeated every tick (D-2361)', () => {
    seed(); check({ BOX_DRAFT: 'half a sentence' });
    expect(enters()).toEqual([]);
    expect(swapLog()).toMatch(/stale-skip myid: usage limit has reset but the input box is not empty/);
    expect(stamp()).toMatch(/^[0-9]+$/);
  });
  it('a blank marker with text on a continuation row is occupied: no synthesized Enter (D-2457)', () => {
    seed(); check({ PANE_TEXT: STALE_WITH_CONTINUATION_DRAFT });
    expect(enters()).toEqual([]);
    expect(swapLog()).toMatch(/stale-skip myid: usage limit has reset but the input box is not empty/);
  });
  it('no prompt visible: nothing', () => { seed(); check({ PANE_TEXT: STALE_NO_PROMPT }); expect(enters()).toEqual([]); });
  it('a running turn: nothing', () => { seed(); check({ PANE_TEXT: BUSY }); expect(enters()).toEqual([]); });
  it('an ARMED auto-continue is not stale: nothing (R3 — never cancel it)', () => { seed(); check({ PANE_TEXT: ARMED }); expect(enters()).toEqual([]); });
  it('a ready pane: nothing', () => { seed(); check({ PANE_TEXT: READY }); expect(enters()).toEqual([]); });
  it('a blank pane: nothing', () => { seed(); check({ PANE_TEXT: '' }); expect(enters()).toEqual([]); });
  it('the tick runs the stale check BEFORE the swap arm (source pin)', () => {
    const src = fs.readFileSync(CCD, 'utf8');
    expect(src).toContain('_sync_uuid "$id"; _auto_stale_check "$id"; _auto_swap_check "$id"; _auto_compact_check "$id"');
  });
});
