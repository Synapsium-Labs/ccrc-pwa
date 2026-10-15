// WHAT PASTED AND LATCHED INPUT BECOMES ON THE WIRE (D-5007, spec 2026-10-14
// §5.4; plan Task 12, revised for the operator's ruling R-LIVE, 2026-10-15).
//
// Three jobs, all decisions the drawer only wires:
// - A PASTE is untrusted text going into a live session. xterm 6.0.0's own
//   `paste()` (`src/browser/Clipboard.ts`) brackets it without removing an end
//   marker inside it, so a clipboard holding `\e[201~` closes the brackets
//   early and what follows it is TYPED, Enter included (plan Refinement 11,
//   invariant I5). The drawer takes every paste before xterm does and sends
//   `typedFrame(text)` instead.
// - Text a keyboard INSERTS is the same untrusted text by another door
//   (`insertedFrame`): it is framed as a paste unless it is one key's bytes.
// - The `ctrl` LATCH turns the next ASCII letter typed into its control code.
//   On a phone that letter arrives as a `beforeinput` on xterm's textarea, and
//   on a keyboard that reports real keys as a keydown xterm consumes at once;
//   `inputLetter` and `keyLetter` say which letter, if any, each one carries.
//
// PURE: no React, no DOM. Every byte it puts on the wire comes from `keyBar.ts`,
// the one table of bytes; this file spells none (`drawer-keybar.test.tsx`).
import { KEY_SEQ, PASTE_CLOSE, PASTE_OPEN, ctrlCode, oneKey } from './keyBar';

const TAB = 0x09;
const LF = 0x0a;
const SPACE = 0x20;
const DEL = 0x7f;

/**
 * The text with every C0 control removed but tab and newline, and DEL. ESC is a
 * C0 control, so every ESC goes, and with it both bracketed-paste markers lose
 * their introducer: what is left of one (`[201~`) is text, and frames nothing.
 * Everything printable is kept whole, non-ASCII included.
 */
export function sanitizeTyped(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0;
    if ((c < SPACE && c !== TAB && c !== LF) || c === DEL) continue;
    out += ch;
  }
  return out;
}

/**
 * The bytes a pasted `text` is sent as.
 *
 * Line endings first (`\r\n` and a lone `\r` are one newline each, before
 * `sanitizeTyped` would drop the CR), then `sanitizeTyped`. Text that still
 * holds a newline is framed as xterm 6.0.0's own `paste()` frames it
 * (`prepareTextForTerminal`, then `bracketTextForPaste`): between the two
 * markers, each newline sent as a CR. So a guarded paste types the bytes
 * xterm's own would, minus any marker that was inside it, and Claude Code
 * takes it as a paste, never as Enter. One line is sent literally.
 */
export function typedFrame(text: string): string {
  const clean = sanitizeTyped(text.replace(/\r\n?/g, '\n'));
  return clean.includes('\n')
    ? `${PASTE_OPEN}${clean.replace(/\n/g, KEY_SEQ.enter)}${PASTE_CLOSE}`
    : clean;
}

/**
 * The letter a latched `ctrl` takes from a `beforeinput` on xterm's textarea,
 * or null (the latch then stays, and the input is left alone).
 *
 * - `insertText`: its first character, when that is an ASCII letter. A word
 *   inserted whole while latched (a swipe, a suggestion) gives its first letter.
 * - `insertCompositionText`: only a composition's FIRST letter, the one that
 *   opens it. The event carries the whole composition, so a letter added to a
 *   composition already open arrives as, say, `helc`: its first letter is not
 *   the one just typed, and taking it would send ^H for a `c`.
 * - nothing else (a replacement, a paste, a deletion, a line break).
 */
export function inputLetter(inputType: string, data: string | null): string | null {
  if (data === null || data === '') return null;
  if (inputType === 'insertText') return ctrlCode(data.charAt(0)) === null ? null : data.charAt(0);
  if (inputType === 'insertCompositionText') return ctrlCode(data) === null ? null : data;
  return null;
}

/** The slice of a keydown `keyLetter` reads. */
export interface KeyLike {
  readonly key: string;
  readonly keyCode: number;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly isComposing: boolean;
}

/** keyCode 229: the key an input method is handling, which reports no letter. */
const IME_KEYCODE = 229;

/**
 * The letter a latched `ctrl` takes from a keydown, or null.
 *
 * WHY A KEYDOWN AT ALL. xterm 6.0.0 sends an unmodified lower-case letter AT
 * KEYDOWN and cancels the event (`CoreBrowserTerminal._keyDown`; an upper-case
 * one at keypress, after the same cancel), so a keyboard that reports real
 * keys (any physical one, and an on-screen one that is not composing) never
 * fires a `beforeinput` for it. One ASCII letter, shifted or not, is taken;
 * a key under any other modifier is the reader's own chord, and a key an IME
 * is handling (composing, or keyCode 229) arrives as a `beforeinput` instead.
 */
export function keyLetter(ev: KeyLike): string | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing || ev.keyCode === IME_KEYCODE) return null;
  return ctrlCode(ev.key) === null ? null : ev.key;
}

/**
 * What a chunk xterm sends while the keyboard is INSERTING text goes out as
 * (`inserted-text-is-sanitised`; invariant I5).
 *
 * A keyboard does not only report keys. It also inserts text into xterm's
 * textarea — an `input` event's `insertText`, a composition's commit, the
 * textarea's growth after a keyCode-229 keydown — and xterm sends that text as
 * it is, no paste event in sight. A phone keyboard's clipboard chip or a
 * suggestion can arrive that way, so text holding `\e[201~` and CRs would reach
 * the pane raw, each CR an Enter. So an inserted chunk that is one key's bytes
 * (`oneKey`: a letter, Enter, an arrow) goes as it is, and anything longer goes
 * as a paste does, `typedFrame(data)`: unchanged when it holds no control at
 * all, sanitised and bracketed when it does, so it can neither end a bracketed
 * paste nor submit a line.
 */
export function insertedFrame(data: string): string {
  return oneKey(data) ? data : typedFrame(data);
}
