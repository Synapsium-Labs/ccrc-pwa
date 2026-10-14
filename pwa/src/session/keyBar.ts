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
