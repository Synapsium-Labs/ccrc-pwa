// The drawer's key bytes, in one table (D-5007, spec 2026-10-14 §5.4). Every key
// the bar sends, in either view, is a KEY_SEQ entry: the grid's quick keys derive
// from it through GRID_KEYS, and `drawer-keybar.test.tsx` fails the build on a key
// byte spelled anywhere else under `pwa/src/session/`.
//
// PURE: no React, no DOM, no imports.

export type KeyName = 'esc' | 'up' | 'down' | 'left' | 'right' | 'enter' | 'ctrlC' | 'ctrlD' | 'backspace'
  | 'tab' | 'shiftTab' | 'space' | 'pgUp' | 'pgDn' | 'ctrlU' | 'ctrlO' | 'ctrlR' | 'ctrlT' | 'ctrlB';

/** The one table of key bytes: exactly what a tmux pane expects for each key.
 *  Esc \x1b · arrows CSI A/B/D/C · Tab \t · Shift+Tab CSI Z · Enter \r ·
 *  PgUp/PgDn CSI 5~/6~ · Backspace DEL · ^X the letter's C0 control. */
export const KEY_SEQ: Readonly<Record<KeyName, string>> = {
  esc: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  enter: '\r',
  ctrlC: '\x03',
  ctrlD: '\x04',
  backspace: '\x7f',
  tab: '\t',
  shiftTab: '\x1b[Z',
  space: ' ',
  pgUp: '\x1b[5~',
  pgDn: '\x1b[6~',
  ctrlU: '\x15',
  ctrlO: '\x0f',
  ctrlR: '\x12',
  ctrlT: '\x14',
  ctrlB: '\x02',
};

/** Bracketed paste's two markers (CSI 200~ and CSI 201~, the bytes xterm's own
 *  `bracketTextForPaste` wraps a paste in): what a pane reads as "the text
 *  between was pasted, not typed". Bytes a pane receives, so they live here
 *  beside the keys' and `typedFrame.ts`, which frames a paste in them, spells
 *  none (D-5007). */
export const PASTE_OPEN = '\x1b[200~';
export const PASTE_CLOSE = '\x1b[201~';

/** Each key's mono keycap legend (DIRECTION) and the name assistive tech reads. */
export const KEY_CAP: Readonly<Record<KeyName, { legend: string; label: string }>> = {
  esc: { legend: 'esc', label: 'Escape' },
  up: { legend: '↑', label: 'Arrow up' },
  down: { legend: '↓', label: 'Arrow down' },
  left: { legend: '←', label: 'Arrow left' },
  right: { legend: '→', label: 'Arrow right' },
  enter: { legend: '⏎', label: 'Enter' },
  ctrlC: { legend: '^C', label: 'Control C' },
  ctrlD: { legend: '^D', label: 'Control D' },
  backspace: { legend: '⌫', label: 'Backspace' },
  tab: { legend: 'tab', label: 'Tab' },
  shiftTab: { legend: '⇧tab', label: 'Shift Tab' },
  space: { legend: 'space', label: 'Space' },
  pgUp: { legend: 'PgUp', label: 'Page up' },
  pgDn: { legend: 'PgDn', label: 'Page down' },
  ctrlU: { legend: '^U', label: 'Control U' },
  ctrlO: { legend: '^O', label: 'Control O' },
  ctrlR: { legend: '^R', label: 'Control R' },
  ctrlT: { legend: '^T', label: 'Control T' },
  ctrlB: { legend: '^B', label: 'Control B' },
};

/** The wrapped view's primary row, before its `⋯` toggle. */
export const PRIMARY_KEYS: readonly KeyName[] = ['esc', 'up', 'down', 'enter', 'ctrlC', 'backspace'];

/** The row `⋯` opens, before its `ctrl` latch. */
export const OVERFLOW_KEYS: readonly KeyName[] = [
  'left', 'right', 'tab', 'shiftTab', 'space', 'pgUp', 'pgDn', 'ctrlU', 'ctrlO', 'ctrlR', 'ctrlT', 'ctrlB',
];

/** The grid view's strip: the drawer's quick keys, in their order, then ^C. */
export const GRID_KEYS: readonly KeyName[] = ['esc', 'up', 'down', 'left', 'right', 'tab', 'shiftTab', 'enter', 'ctrlC'];

/** The control code a latched `ctrl` turns one typed ASCII letter into
 *  (a/A → \x01 … z/Z → \x1a). Anything that is not exactly one ASCII letter is
 *  null: a digit, an accented letter, two characters, the empty string. */
export function ctrlCode(ch: string): string | null {
  if (!/^[A-Za-z]$/.test(ch)) return null;
  return String.fromCharCode(ch.toUpperCase().charCodeAt(0) - 0x40);
}

/** The keys a TAP holds for a confirm while Claude Code's exit notice shows
 *  (D-5007, spec 2026-10-14 §5.4): the second of either ends the session. */
export const GUARDED_KEYS: readonly KeyName[] = ['ctrlC', 'ctrlD'];

/** The guarded key these bytes are, or null. Matched on the BYTES, so a ^C
 *  the `ctrl` latch makes out of a typed `c` is the same key as the cap. */
export function guardedKey(data: string): KeyName | null {
  return GUARDED_KEYS.find((k) => KEY_SEQ[k] === data) ?? null;
}

/** What Claude Code prints under its box after a first Ctrl-C (or Ctrl-D)
 *  with an empty draft, until the second one ends it or the notice times out (W11). */
const EXIT_NOTICE = /Press Ctrl-[CD] again to exit/;

/** How many of the screen's last rows the notice is looked for in: the box's
 *  bottom rule and what Claude Code draws under it — a status line, the footer
 *  and a notification row are all recorded there under a real box
 *  (`server/test/fixtures/panes/cc291-model-default-ack-120x30.txt`). It never
 *  reaches up into the transcript, where a reply can quote the same words. */
const EXIT_NOTICE_ROWS = 4;

/**
 * Whether the screen shows Claude Code's exit notice: the notice in its last
 * four rows, counted UP FROM ITS LAST NON-BLANK ROW.
 *
 * NOT the model's last four rows as they stand. Claude Code can draw its box
 * mid-screen, with blank rows under its footer: a 220x50 capture of it
 * (`server/test/fixtures/panes/cc291-model-ack-220x50-full.txt`) has eleven
 * blank rows below the footer. There the window's last rows are blank, and a
 * guard reading them would never see the notice: it would send the second ^C
 * that ends the session. The blank rows are dropped first.
 *
 * `rows` is the screen as text, one string per window row, top first: the
 * caller reads the model AT TAP TIME, never a copy cached earlier.
 */
export function exitNoticeShowing(rows: readonly string[]): boolean {
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.trim() === '') end--;
  return rows.slice(Math.max(0, end - EXIT_NOTICE_ROWS), end).some((r) => EXIT_NOTICE.test(r));
}

/**
 * Where a bar of `caps` caps breaks when one line cannot hold it: the first
 * line takes the larger half, `ceil(caps / 2)`, and the second the rest, so a
 * two-line bar is two even halves and never a lone cap on a line of its own
 * (`key-bar-wraps-when-it-does-not-fit`). The wrapped bar's eight (its six keys,
 * `⋯` and the history door) break 4 + 4; the grid's ten (its nine keys and the
 * door) 5 + 5. WHETHER it breaks is the browser's, measured against the space
 * the bar actually has: nothing names a width for it (chat.css, `.term-keys`).
 */
export function barBreak(caps: number): number {
  return Math.ceil(caps / 2);
}

/**
 * The row `⋯` opens, in four groups: `barBreak` of each half, so the thirteen
 * caps (its twelve keys and the `ctrl` latch) are `← → tab ⇧tab`,
 * `space PgUp PgDn`, `^U ^O ^R` and `^T ^B ctrl`. Each group wraps as a whole,
 * so wherever the row breaks — two lines on an iPhone Pro Max, three on most
 * phones, four at 320px — every line holds a group of three or more, never
 * `ctrl` alone (`key-bar-wraps-when-it-does-not-fit`).
 */
export function quarters(caps: number): number[] {
  const half = barBreak(caps);
  const a = barBreak(half);
  const b = barBreak(caps - half);
  return [a, half - a, b, caps - half - b];
}

/** What ONE key sends, as xterm 6.0.0's `evaluateKeyboardEvent` spells it: one
 *  character; ESC and one character (Alt, or Alt with Enter, Esc or Backspace);
 *  a CSI sequence, parameters and final (the arrows, Home, End, the function and
 *  editing keys, each with or without a modifier); or SS3 and one character. */
const ONE_KEY = /^(?:[\s\S]|\x1b[\s\S]|\x1b\[[0-?]*[ -/]*[@-~]|\x1bO[\s\S])$/u;

/**
 * Whether `data` is one key's bytes (`inserted-text-is-sanitised`): what a
 * keyboard sends for a key, whichever key it is — every KEY_SEQ entry included.
 * Never a bracketed-paste marker: no key sends one, and an insertion that is
 * nothing but `\e[201~` is exactly what must not reach a pane as a marker.
 */
export function oneKey(data: string): boolean {
  return ONE_KEY.test(data) && data !== PASTE_OPEN && data !== PASTE_CLOSE;
}
