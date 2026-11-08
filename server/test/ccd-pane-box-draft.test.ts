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
import { spawnSyncGroup } from './spawnGroup.js';
// `server/package.json` is `"type":"module"`, so `require` is NOT defined in
// this scope — a CommonJS read here throws ReferenceError and the mutation
// guard at the bottom of this file asserts nothing at all.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CCD, ghContainedEnv, makeCcdHarness, type CcdHarness, ccdSource } from './ccdWsHelpers.js';
// The OTHER reader. "One reader for the box row" is this file's whole thesis,
// and until now it was asserted only in prose: the parity table below makes it
// an assertion, over the escape-carrying rows that are the entire reason the
// two implementations can disagree.
import { draftOf } from '../src/inject/send.js';
import { hasMenu, stripSgr } from '../src/pane/dialog.js';

let h: CcdHarness;
beforeEach(() => { h = makeCcdHarness('ccrc-ccd-box-draft-'); });
afterEach(() => { h.cleanup(); });

/** U+00A0. Spelled as an escape, not as a literal, so the byte under test
 *  survives every editor and diff viewer this file passes through. */
const NBSP = '\u00a0';

/** Runs one pane reader in a fixture HOME. */
const paneRead = (command: string, pane: string): string => {
  const r = spawnSyncGroup('bash', ['-c', `source "${CCD}"; ${command}`, 'bash', pane], {
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
/** Runs `_pane_box_read` over a pane: `empty`, `draft` or `absent` (D-8116). */
const boxRead = (pane: string): string => paneRead('_pane_box_read "$1"', pane);
/** Answers whether any real content occupies the marker or continuation rows. */
const occupied = (pane: string): boolean => boxRead(pane) === 'draft';

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

  it('reads nothing from a pane with no box at all, and says so with rc 2 (D-8116)', () => {
    expect(paneRead('_pane_box_draft "$1"; printf "rc=%s" "$?"', 'just some output\nno marker here\n')).toBe('rc=2');
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
    const src = ccdSource();
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
describe('_pane_box_read reads the whole input box (D-2457)', () => {
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
    // D-5910: the widened encodings still end at the FIRST close, never past it.
    ['a combined dim open (\\e[2;3m) is a dim run that a combined reset ends',
      `${ESC}[39m❯${NBSP}${ESC}[2;3mghost${ESC}[0;1mREAL${ESC}[0m`, 'REAL'],
    ['a reset-first dim open (\\e[0;2m) is a dim run that a dim-off (\\e[22m) ends',
      `${ESC}[39m❯${NBSP}${ESC}[0;2mghost${ESC}[22mREAL${ESC}[0m`, 'REAL'],
    ['a combined dim-off (\\e[22;1m) ends the run, it is not absorbed by it',
      `${ESC}[39m❯${NBSP}${ESC}[2mghost${ESC}[22;1mREAL${ESC}[0m`, 'REAL'],
    // D-6006: a reset that turns dim straight back on (\e[0;2m) continues the run, never closes it.
    ['a dim+inverse cursor cell then plain dim is all one dim run',
      `${ESC}[39m❯${NBSP}${ESC}[2;7mT${ESC}[0;2mry "edit"${ESC}[0m`, ''],
    ['an italic drop mid-run (\e[0;2m) is all one dim run',
      `${ESC}[39m❯${NBSP}${ESC}[2;3mTry${ESC}[0;2m "edit"${ESC}[0m`, ''],
    ['a bold-dim then dim (\e[1;2m, \e[0;2m) is all one dim run',
      `${ESC}[39m❯${NBSP}${ESC}[1;2mB${ESC}[0;2mD${ESC}[0m`, ''],
    ['real text after the true close of a mid-reset run survives',
      `❯ ${ESC}[2;3mghost${ESC}[0;2mmore${ESC}[0mREAL${ESC}[0m`, 'REAL'],
    ['a reset that keeps dim off (\\e[0;22m) still ends the run',
      `❯ ${ESC}[2mghost${ESC}[0;22mREAL${ESC}[0m`, 'REAL'],
    ['a parameterless reset (\e[m) ends the run, it is not absorbed by it',
      `❯ ${ESC}[2mghost${ESC}[mREAL${ESC}[0m`, 'REAL'],
    ['a truecolour code holding a 2 is not a dim open',
      `❯ ${ESC}[38;2;10;20;30mreal colour${ESC}[0m`, 'real colour'],
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
    const src = ccdSource();
    // Greedy to the LAST `)"` on the line, not `[^)]*` to the first: D-2363's
    // site resolves its own tmux target (`-t "$(_tmux "$id")"`), so a nested
    // `)"` sits mid-call, ahead of the real close — a class excluding `)`
    // truncates there and silently drops the trailing ` -e` from the match.
    const calls = src.match(/_pane_box_read "\$\(tmux capture-pane.*\)"/g) ?? [];
    // Six sites: `_idle_for_keystroke` (the compactor's and the route applier's
    // gate), `_inject_spawn_effort`, `_redrive_after_spawn`, `_session_hard_blocked`,
    // `_auto_stale_check`, and `_auto_swap_check`'s draft stand-down (D-6181).
    // Every one can destroy or submit the box, so every one must ask the
    // whole-box presence question rather than read row one.
    expect(calls, 'all six synthesized-action guards use the whole-box reader').toHaveLength(6);
    for (const c of calls) expect(c, c).toContain(' -e');
  });
});

/**
 * D-5910: the box reader's corpus (`fixtures/panes/box/`, recorded and described in `send-box-corpus.test.ts`) holds
 * one verdict column per caller. This is ccd's: `_pane_box_draft` answers only the last marker row, so its column is
 * that row's text, and `null` where a capture asks it nothing (no `absent` verdict, no multi-line read, nothing below
 * the marker). Its dim strip must take every encoding `DIM_SPAN` takes, or a placeholder reads as a draft here and
 * every synthesized ccd action refuses an idle box for ever.
 */
describe("ccd's `_pane_box_draft` answers its column on every capture (D-5910)", () => {
  const boxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes', 'box');
  const column = (JSON.parse(readFileSync(path.join(boxDir, 'verdicts.json'), 'utf8')) as {
    captures: Record<string, { _pane_box_draft: string | null }>;
  }).captures;

  it('the column covers the whole corpus', () => {
    const files = readdirSync(boxDir).filter((f) => f.endsWith('.ansi')).sort();
    expect(Object.keys(column).sort()).toEqual(files);
    expect(Object.values(column).filter((v) => v._pane_box_draft !== null).length).toBeGreaterThanOrEqual(10);
  });

  for (const [name, verdict] of Object.entries(column)) {
    if (verdict._pane_box_draft === null) continue;
    it(name, () => {
      expect(draft(readFileSync(path.join(boxDir, name), 'utf8'))).toBe(verdict._pane_box_draft);
    });
  }
});

/**
 * D-8116: the third answer. A `❯` row is the box only when it sits directly under a `─` border (`_pane_outside_box`'s
 * rule). Claude Code's own limit dialog takes the box's place and indents its cursor row, so the last `❯` row left on
 * screen is an old turn or the dialog's echo. Read as a draft, that stood the limit rescue down for as long as the
 * dialog stayed open.
 */
describe('D-8116: no bordered box is its own answer, `absent`', () => {
  const boxDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes', 'box');
  const capture = (name: string): string => readFileSync(path.join(boxDir, name), 'utf8');
  const DIALOGS = ['rate-limit-dialog.ansi', 'rate-limit-dialog-mail-row.ansi'];

  for (const name of DIALOGS) {
    it(`${name}: the limit dialog reads absent, where the last-row rule read a draft`, () => {
      const pane = capture(name);
      expect(boxRead(pane)).toBe('absent');
      expect(paneRead('_pane_box_draft "$1"; printf "rc=%s" "$?"', pane)).toBe('rc=2');
      // The server agrees from the other side: a menu is up, and its marker-row read alone would take a stale row.
      expect(hasMenu(stripSgr(pane))).toBe(true);
      expect(draftOf(pane)).not.toBe('');
    });
  }

  it('an old turn with no box under it reads absent, not its text', () => {
    expect(boxRead('❯ ccrc-mail: a message is waiting\n  ⎿  You hit a limit\n')).toBe('absent');
  });

  it('a dialog cursor indented under its own border is not the box', () => {
    expect(boxRead(`❯ /rate-limit-options\n\n${'─'.repeat(24)}\n  What do you want to do?\n  ❯ 1. Stop\n    2. Upgrade\n`)).toBe('absent');
  });

  // The real 2.1.291 shape (`_pane_model_state`): on a full pane the bordered box and statusline stay drawn UNDER an
  // open slash-command dialog, so the border rule finds a bare `❯` box row and only the dialog's cursor row tells.
  const RECORDED = ['cc291-model-picker-220x50-full.ansi', 'cc291-model-default-switch-120x30.ansi'];
  for (const name of RECORDED) {
    it(`${name}: a dialog drawn over an empty box reads absent, not empty`, () => {
      const p = capture(name);
      expect(draft(p)).toBe('');
      expect(boxRead(p)).toBe('absent');
      // The server's `promptBoxShowing` veto fires on this shape, so `hasMenu` misses the dialog: no mirror helps.
      expect(hasMenu(stripSgr(p))).toBe(false);
    });
  }

  const rule = '─'.repeat(24);
  const box = [rule, `❯${NBSP}`, rule, '  👤 team·max'];
  it('a footer beside an indented cursor row opens a dialog even with no border above it', () => {
    const dlg = ['● a reply', '  Pick one', '  ❯ 1. Switch to usage credits', '    2. Stop',
      '  Enter to confirm · Esc to cancel'];
    expect(boxRead([...dlg, ...box].join('\n') + '\n')).toBe('absent');
  });

  it('a reply quoting a cursor row, with no border or footer around it, leaves the box empty', () => {
    const quote = ['● The menu looks like this:', '  ❯ 1. Yes, switch', '    2. No, go back', '  Done.'];
    expect(boxRead([...quote, ...box].join('\n') + '\n')).toBe('empty');
  });

  it('a dialog in scrollback above an older box does not reach the box below it', () => {
    const old = [rule, '  Select model', '  ❯ 1. Default', '  Esc to cancel'];
    expect(boxRead([...old, rule, '● a reply after it', ...box].join('\n') + '\n')).toBe('empty');
  });

  it('a draft under a dialog still reads draft, so the limit swap stands down on it', () => {
    const dlg = [rule, '  Switch model?', '  ❯ 1. Yes, switch to Opus', '    2. No, go back', ''];
    expect(boxRead([...dlg, rule, '❯ half a sentence', rule].join('\n') + '\n')).toBe('draft');
  });

  it('a real draft in a bordered box still reads draft, with an old turn above it', () => {
    expect(boxRead(pane(['❯ half a sentence']))).toBe('draft');
    expect(boxRead(pane([`❯${NBSP}`]))).toBe('empty');
  });

  it("the corpus's `_pane_box_read` column holds on every capture", () => {
    const column = (JSON.parse(readFileSync(path.join(boxDir, 'verdicts.json'), 'utf8')) as {
      captures: Record<string, { _pane_box_read: string }>;
    }).captures;
    const files = readdirSync(boxDir).filter((f) => f.endsWith('.ansi')).sort();
    expect(Object.keys(column).sort()).toEqual(files);
    for (const name of files) expect(boxRead(capture(name)), name).toBe(column[name]!._pane_box_read);
    for (const name of DIALOGS) expect(column[name]!._pane_box_read).toBe('absent');
  });
});
