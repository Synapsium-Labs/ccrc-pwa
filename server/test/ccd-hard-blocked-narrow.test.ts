// ccd's hard-block detectors decide a forced account swap (`_auto_swap_check`),
// a strand, a skipped re-drive, and spawn rc 5 — and they grep pane TEXT. Two
// narrowings, each measured against real Claude Code 2.1.280 panes (private
// tmux, mock API, both renderers): the prompt box is not read, because no
// banner ever renders in it and a human's draft does; and `rate limit` no
// longer matches bare. Neither can make a swap fire that did not before.
//
// FIXTURE HOME ONLY (makeCcdHarness). No tmux: the functions are handed text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-hard-narrow-'); });
afterEach(() => { h.cleanup(); });

/** `fn` over `pane` (through a file, so the rows stay rows) -> did it match. */
const hit = (fn: '_pane_hard_blocked' | '_pane_limit_banner', pane: string): boolean => {
  fs.writeFileSync(`${h.home}/pane.txt`, pane);
  return h.sh(`${fn} "$(cat "$HOME/pane.txt")" && echo Y || echo N`) === 'Y';
};

const RULE = '─'.repeat(50);
const ROW = '  👤 cfg │ 🤖 Opus 5.5 (1M context) · medium │ ⎇ ws/rig-branch │ 🎯 repo │ ▓ ctx ░░░░░░░░ 0% │ 💲 $0.0281';
/** The last rows of a real idle 2.1.280 pane: whatever is above, the box, the
 *  statusline row, the mode row — `tail -8`'s whole window in classic. */
const pane = (above: string[], box: string[] = ['❯ '], below: string[] = []): string =>
  [...above, '', RULE, ...box, RULE, ROW, '  ⏸ manual mode on', ...below].join('\n');

describe('the prompt box is not read — a draft is not a banner', () => {
  // Measured: this exact draft matched `_pane_hard_blocked` in all four layouts,
  // and the rescue arm swaps "draft or not".
  const DRAFT = ['❯ draft: why did the rate limit reached banner show API Error: 429 Too Many Requests?'];

  it('a draft holding the trigger words does not block', () => {
    expect(hit('_pane_hard_blocked', pane(['✻ Baked for 6s · done 4:06 PM'], DRAFT))).toBe(false);
  });

  it('…nor a multi-line one, nor one under a TITLED top border', () => {
    const titled = ['', `${'─'.repeat(38)} ultracode ─`, '❯ first line', '  Please run /login, it said', RULE, ROW].join('\n');
    expect(hit('_pane_hard_blocked', titled)).toBe(false);
  });

  it('the banner rung does not read the box either', () => {
    expect(hit('_pane_limit_banner', pane([], ["❯ it said You've hit your session limit · resets 5:49pm"]))).toBe(false);
  });

  it('control: the same words ABOVE the box still match — only the box is excluded', () => {
    expect(hit('_pane_hard_blocked', pane(['  ⎿  API Error: 429 Too Many Requests']))).toBe(true);
  });

  it('control: the real auto-continue footer BELOW the box still matches', () => {
    // OAuth limit with auto-continue on, as captured: the `⚠` footer three rows
    // under the box's bottom border, inside every reader's window.
    const p = pane(['✻ Churned for 0s · done 4:01 PM'], ['❯ '],
      ['', '  ⚠ Usage limit reached · continuing automatically at 5:49pm · esc to cancel']);
    expect(hit('_pane_hard_blocked', p)).toBe(true);
  });

  it('control: the real subscriber banner above the box is still the banner rung\'s', () => {
    const p = pane(['❯ go', "  ⎿  You've hit your session limit · resets 5:49pm (UTC)", '✻ Churned for 0s · done 4:01 PM']);
    expect(hit('_pane_limit_banner', p)).toBe(true);
  });
});

describe('`rate limit` does not match bare', () => {
  it('a sentence about rate limits is not a banner', () => {
    expect(hit('_pane_hard_blocked', pane(['⏺ I checked the rate limit handling; nothing to fix.']))).toBe(false);
  });

  it('a --resume landing re-rendering an old API-key 429 is not blocked (measured: both renderers)', () => {
    // `_spawn_settle` reads the FULL pane for rc 5; Claude Code 2.1.280
    // re-renders the resumed conversation's rows, old API-error row included.
    const p = pane(['❯ hi', '● API Error: Request rejected (429) · Number of request tokens has exceeded your per-minute rate limit',
      '❯ /effort high', '  ⎿  Set effort level to high (saved as your default for new sessions): …']);
    expect(hit('_pane_hard_blocked', p)).toBe(false);
  });

  it.each(['rate limited', 'rate limit exceeded', 'rate limit reached'])('control: "%s" still matches', (words) => {
    expect(hit('_pane_hard_blocked', pane([`  ⎿  API Error: ${words}`]))).toBe(true);
  });
});
