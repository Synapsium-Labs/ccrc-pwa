/**
 * ONE marker-row reader aligned with `draftOf` (server/src/inject/send.ts),
 * plus one whole-box presence guard shared by every synthesized ccd action.
 *
 * Both guards read the FIRST `❯` line with a PLAIN space today. Measured on
 * this box, that is wrong in both directions: it returns a scrollback turn
 * (`❯ /compact`) while the real box is empty — failing shut, skipping a
 * legitimate compact — and it returns NOTHING while the box row is `❯` +
 * U+00A0 + text, which is failing OPEN, i.e. typing a slash command on top of
 * somebody's draft.
 *
 * The NBSP is not a guess: `send.test.ts`'s LIVE_CU_FRAMES is a verbatim
 * `capture-pane -e` of a real TYPED draft and its box row is
 * `'\x1b[39m❯\xa0AAA first line'`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
// `server/package.json` is `"type":"module"`, so `require` is NOT defined in
// this scope — a CommonJS read here throws ReferenceError and the mutation
// guard at the bottom of this file asserts nothing at all.
import { readFileSync } from 'node:fs';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness } from './ccdWsHelpers.js';
// The OTHER reader. "One reader for the box row" is this file's whole thesis,
// and until now it was asserted only in prose: the parity table below makes it
// an assertion, over the escape-carrying rows that are the entire reason the
// two implementations can disagree.
import { draftOf } from '../src/inject/send.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-box-draft-'); });
afterEach(() => { h.cleanup(); });

/** U+00A0. Spelled as an escape, not as a literal, so the byte under test
 *  survives every editor and diff viewer this file passes through. */
const NBSP = '\u00a0';

/** Runs one pane reader in a fixture HOME. */
const paneRead = (command: string, pane: string): string => {
  const r = spawnSync('bash', ['-c', `source "${CCD}"; ${command}`, 'bash', pane], {
    encoding: 'utf8', cwd: h.home, timeout: 15000,
    // BOTH poisons. This snippet sources ccd, so it can reach
    // `_have_systemctl`/`_supervised_start`, and `ccd-workspaces.test.ts`'s
    // source scan is what makes that a property of every ccd test file rather
    // than a rule each one remembers.
    env: ghContainedEnv(h.home, { ...process.env, HOME: h.home }, { systemd: true, tmux: true }),
  });
  expect(r.status, r.stderr ?? '').toBe(0);
  return (r.stdout ?? '').replace(/\n$/, '');
};
/** Runs `_pane_box_draft` over a pane and returns exactly what it echoed. */
const draft = (pane: string): string => paneRead('_pane_box_draft "$1"', pane);
/** Answers whether any real content occupies the marker or continuation rows. */
const occupied = (pane: string): boolean =>
  paneRead('_pane_box_has_content "$1" && printf yes || printf no', pane) === 'yes';

const pane = (boxRows: string[]): string =>
  ['earlier turn', `❯ an older submitted turn`, '● a reply', '─'.repeat(24),
    ...boxRows, '─'.repeat(24), '  👤 team·max'].join('\n') + '\n';

describe('_pane_box_draft', () => {
  it('reads the LAST marker line, not the first — a scrollback turn is not the box', () => {
    // The measured failure: `grep -m1` returned `/compact` from the scrollback
    // while the box was empty, so auto-compact skipped a session forever.
    expect(draft(pane([`❯${NBSP}`]))).toBe('');
  });

  it('accepts U+00A0 as the separator — the byte a real typed draft actually carries', () => {
    expect(draft(pane([`❯${NBSP}fix the flaky test`]))).toBe('fix the flaky test');
  });

  it('still accepts a plain space', () => {
    expect(draft(pane(['❯ fix the flaky test']))).toBe('fix the flaky test');
  });

  it('trims trailing whitespace, as the guards it replaces did', () => {
    expect(draft(pane([`❯${NBSP}half a thought   `]))).toBe('half a thought');
  });

  it('reads nothing from a pane with no box at all', () => {
    expect(draft('just some output\nno marker here\n')).toBe('');
  });

  // The separator is stripped as the WHOLE two-byte NBSP or a whole space, not
  // as a byte class over {0x20,0xc2,0xa0}: a byte class eats the 0xc2 LEAD BYTE
  // of any Latin-1-supplement character the draft happens to start with, and
  // hands the caller a mojibake fragment of the operator's own text.
  it('does not eat the lead byte of a draft that starts with a two-byte character', () => {
    expect(draft(pane([`❯${NBSP}£5 is the budget`]))).toBe('£5 is the budget');
    expect(draft(pane(['❯ ¡ojo! check the staging deploy']))).toBe('¡ojo! check the staging deploy');
  });

  // The mutation table: reinstating either half of the old rule reds a test
  // above. `grep -m1` reds test 1; a plain-space-only separator reds test 2.
  it('is the ONLY box-row reader left in ccd — no inline grep survives', () => {
    const src = readFileSync(CCD, 'utf8');
    expect(src.match(/grep -m1 "\^❯ "/g), 'an inline box-row grep is back').toBeNull();
    expect((src.match(/_pane_box_draft\(\)/g) ?? []).length).toBe(1);
  });
});

/**
 * THE ESCAPE CODES ARE NOT DECORATION — they are what tells a REAL draft from
 * Claude Code's dim ghost-suggestion, and this reader was blind to both halves
 * of that at once (measured on this box, 2026-08-17):
 *
 *  - Handed a PLAIN `capture-pane -p`, which is what both call sites passed,
 *    the dim ghost ("continue") arrives as ordinary characters: the reader
 *    returned `continue` for an EMPTY box, where the rule it replaced returned
 *    ''. Both callers refuse on a non-empty read and neither ever retries, so
 *    an idle session showing a suggestion was refused FOREVER — a live
 *    regression of the common shape, since the empty box's own separator is
 *    `❯` + U+00A0 and the ghost sits right after it.
 *  - Handed a `-e` capture with NO stripping, it is worse, not better: the box
 *    row starts with a colour code (`\e[39m❯…`, verbatim in LIVE_CU_FRAMES),
 *    so the marker grep misses it entirely and `tail -1` lands on a plain
 *    SCROLLBACK turn — measured, `an older submitted turn`.
 *
 * So the fix is both halves together, and the pin is parity with `draftOf`,
 * which has stripped `DIM_SPAN` and SGR since it shipped.
 */
describe('_pane_box_has_content reads the whole input box (D-2457)', () => {
  it('finds a draft below a blank marker row', () => {
    expect(occupied(pane([`❯${NBSP}`, '  half a sentence']))).toBe(true);
  });

  it('does not mistake chrome below the closing rule for box content', () => {
    expect(occupied(pane([`❯${NBSP}`]))).toBe(false);
  });

  it('does not promote a dim ghost suggestion into real content', () => {
    expect(occupied(pane([`\x1b[39m❯${NBSP}\x1b[2mcontinue\x1b[0m`]))).toBe(false);
  });

  it('still finds an ordinary marker-row draft', () => {
    expect(occupied(pane([`❯${NBSP}half a sentence`]))).toBe(true);
  });
});

describe('_pane_box_draft reads an ANSI capture, exactly as draftOf does', () => {
  const ESC = '\x1b';
  /** Verbatim box rows. The first two are `send.test.ts`'s own live captures
   *  (`CAPTURED_QUEUE_HINT_ROW`, `LIVE_CU_FRAMES`); the combined-reset row is
   *  the tmux-3.4 normalisation that broke `DIM_SPAN` round 2. */
  const ROWS: readonly (readonly [string, string, string])[] = [
    ['a dim ghost-suggestion is not a draft',
      `${ESC}[39m❯${NBSP}${ESC}[2m${ESC}[39mcontinue${ESC}[0m`, ''],
    ['the busy-session queue hint is not a draft',
      `${ESC}[38;5;246m❯${NBSP}${ESC}[2m${ESC}[39mPress up to edit queued messages${ESC}[0m`, ''],
    ['a real typed draft on a COLOURED marker row is a draft',
      `${ESC}[39m❯${NBSP}AAA first line`, 'AAA first line'],
    ['a combined reset (\\e[0;1m) ends the dim run, it does not swallow what follows',
      `❯ ${ESC}[2mghost${ESC}[0;1mBOLD REAL${ESC}[0m`, 'BOLD REAL'],
    ['an empty coloured box is empty',
      `${ESC}[39m❯${NBSP}`, ''],
  ];

  for (const [name, row, expected] of ROWS) {
    it(name, () => {
      // ABSOLUTE, then parity: a mutant that made both readers answer '' for
      // everything would keep parity green while destroying every draft.
      expect(draft(pane([row]))).toBe(expected);
      expect(draft(pane([row]))).toBe(draftOf(pane([row])));
    });
  }

  // The reader can only strip what it is given. Every call site must capture
  // with `-e`; a plain `-p` read is the regression measured above.
  it('every call site hands it an ANSI capture', () => {
    const src = readFileSync(CCD, 'utf8');
    // Greedy to the LAST `)"` on the line, not `[^)]*` to the first: D-2363's
    // site resolves its own tmux target (`-t "$(_tmux "$id")"`), so a nested
    // `)"` sits mid-call, ahead of the real close — a class excluding `)`
    // truncates there and silently drops the trailing ` -e` from the match.
    const calls = src.match(/_pane_box_has_content "\$\(tmux capture-pane.*\)"/g) ?? [];
    // Five sites: the two injectors (`_auto_compact_check` and
    // `_inject_spawn_effort`), `_redrive_after_spawn`, `_session_hard_blocked`,
    // and `_auto_stale_check`. Every one can destroy or submit the box, so every
    // one must ask the whole-box presence question rather than read row one.
    expect(calls, 'all five synthesized-action guards use the whole-box reader').toHaveLength(5);
    for (const c of calls) expect(c, c).toContain(' -e');
  });
});
