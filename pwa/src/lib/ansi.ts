// ANSI colour for a tool well (T4a, D-6387): the SGR codes in a transcript record's text, read into runs of one hue
// each, every other control sequence removed. Pure and L1: it imports nothing, and no ANSI value ever reaches a
// `style` attribute. A run carries a hue NAME, the well draws it as the class `ansi-<hue>`, and the class paints a
// palette token, so a colour is measured by the contrast gate like any other well ink.
//
// The six hues are the drawer's `GLASS_ANSI[1..6]` (`session/drawerModel.ts#GLASS_ANSI`), reached through the code
// palette's tokens; `ansi.test.ts` pins that the two agree. White (37, 97), the defaults and everything this reader
// does not draw (backgrounds, reverse video, 256 and truecolour beyond the first 16) take the well's own ink.
//
// Legitimately different from the drawer's reader (T4a plan): the drawer paints xterm's parsed buffer as the pane
// shows it, cursor moves and erases already applied; a transcript record is static text in a gated well, so the
// movement and erase sequences are dropped rather than replayed. The scanner is one linear pass.

export type AnsiHue = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'muted';

/** A stretch of text of one hue; `null` is the well's own ink (no class). */
export interface AnsiRun {
  text: string;
  hue: AnsiHue | null;
}

/** The palette token each hue paints. ONE table: the class name derives from the key (`ansiClass`). */
export const ANSI_HUE_TOKEN: Readonly<Record<AnsiHue, string>> = {
  red: '--diff-del',
  green: '--diff-add',
  yellow: '--syn-number',
  blue: '--syn-type',
  magenta: '--syn-keyword',
  cyan: '--syn-function',
  muted: '--syn-comment',
};

export const ansiClass = (hue: AnsiHue): string => `ansi-${hue}`;

/** Any escape needs the static transcript reader, including non-SGR controls. */
export const hasEscape = (text: string): boolean => text.includes('\x1b');

/** Reversible, single-line display text for a synthetic diff header. */
export const escapeHeader = (text: string): string =>
  JSON.stringify(text).slice(1, -1).replace(/[\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);

/** Whether the shared transcript scanner encounters an SGR sequence. */
export function hasSgr(text: string): boolean {
  return scanAnsi(text).sgr;
}

const ESC = 0x1b;
const BEL = 0x07;

/** Hue of a basic foreground code, 30–37 or 90–97 (the bright set reads as the normal one). */
const BASIC: readonly (AnsiHue | null)[] = ['muted', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', null];

function basicHue(code: number): AnsiHue | null | undefined {
  if (code >= 30 && code <= 37) return BASIC[code - 30];
  if (code >= 90 && code <= 97) return BASIC[code - 90];
  return undefined;
}

/** `38;5;n`'s hue: 0–7 as 30+n, 8–15 as 90+(n-8), any other index (or none) the well's ink. */
const indexedHue = (n: number): AnsiHue | null => (n >= 0 && n < 16 ? (basicHue(n < 8 ? 30 + n : 90 + n - 8) ?? null) : null);

const num = (s: string | undefined): number => (s === undefined || s === '' ? 0 : /^\d+$/.test(s) ? Number(s) : NaN);

interface Pen {
  fg: AnsiHue | null;
  dim: boolean;
}

/** Apply one SGR parameter list to the pen. Colons (`38:5:n`) group a code's own sub-parameters. */
function applySgr(pen: Pen, params: string): void {
  const list = params === '' ? ['0'] : params.split(';');
  for (let k = 0; k < list.length; k += 1) {
    const sub = list[k]!.split(':');
    const code = num(sub[0]);
    if (code === 38 || code === 48) {
      // An extended colour consumes its own parameters whether or not it is drawn; a background is never drawn.
      let kind: string | undefined;
      let n: number;
      if (sub.length > 1) {
        kind = sub[1];
        n = num(sub[2]);
      } else {
        kind = list[k + 1];
        n = num(list[k + 2]);
        if (kind === '5') k += 2;
        else if (kind === '2') k += 4;
      }
      if (code === 38 && (kind === '5' || kind === '2')) pen.fg = kind === '5' ? indexedHue(n) : null;
    } else if (code === 0) {
      pen.fg = null;
      pen.dim = false;
    } else if (code === 2) pen.dim = true;
    else if (code === 22) pen.dim = false;
    else if (code === 39) pen.fg = null;
    else {
      const hue = basicHue(code);
      if (hue !== undefined) pen.fg = hue;
    }
  }
}

/**
 * The text split into runs of one hue. Adjacent runs of the same hue merge, empty runs are dropped, `''` gives `[]`,
 * and text with no ESC is exactly `[{ text, hue: null }]`. No ESC byte survives in any run's text: SGR sequences set
 * the pen, every other escape sequence is removed (non-SGR CSI, OSC, DCS/SOS/PM/APC strings, charset designators and
 * other two-byte escapes, a lone or trailing ESC), and an unterminated one is removed to the end of the text.
 */
export function ansiRuns(text: string): AnsiRun[] {
  return scanAnsi(text).runs;
}

function scanAnsi(text: string): { runs: AnsiRun[]; sgr: boolean } {
  if (text === '') return { runs: [], sgr: false };
  if (!hasEscape(text)) return { runs: [{ text, hue: null }], sgr: false };
  const runs: AnsiRun[] = [];
  let sgr = false;
  const pen: Pen = { fg: null, dim: false };
  const hue = (): AnsiHue | null => pen.fg ?? (pen.dim ? 'muted' : null);
  const push = (s: string): void => {
    if (s === '') return;
    const last = runs[runs.length - 1];
    const h = hue();
    if (last !== undefined && last.hue === h) last.text += s;
    else runs.push({ text: s, hue: h });
  };
  const n = text.length;
  let from = 0; // start of the text not yet pushed
  let i = 0;
  while (i < n) {
    if (text.charCodeAt(i) !== ESC) {
      i += 1;
      continue;
    }
    push(text.slice(from, i));
    const c = i + 1 < n ? text.charCodeAt(i + 1) : -1;
    let j = i + 2;
    if (c === 0x5b) {
      // CSI: parameter bytes 0x30–0x3F, intermediates 0x20–0x2F, one final byte 0x40–0x7E.
      const p0 = j;
      while (j < n && text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x3f) j += 1;
      const p1 = j;
      while (j < n && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j += 1;
      if (j < n && text.charCodeAt(j) >= 0x40 && text.charCodeAt(j) <= 0x7e) {
        if (j === p1 && text.charCodeAt(j) === 0x6d) {
          const params = text.slice(p0, p1);
          if (/^[0-9;:]*$/.test(params)) {
            sgr = true;
            applySgr(pen, params);
          }
        }
        j += 1;
      }
    } else if (c === 0x5d || c === 0x50 || c === 0x58 || c === 0x5e || c === 0x5f) {
      // OSC (BEL or ST ends it) and the DCS/SOS/PM/APC strings (ST ends them). A bare ESC inside cancels the string
      // and starts the next sequence; one never ended runs to the end of the text.
      while (j < n) {
        const d = text.charCodeAt(j);
        if (d === BEL && c === 0x5d) {
          j += 1;
          break;
        }
        if (d === ESC) {
          if (text.charCodeAt(j + 1) === 0x5c) j += 2;
          break;
        }
        j += 1;
      }
    } else if (c >= 0x20 && c <= 0x7e) {
      // Intermediates (0x20–0x2F: the charset designators `( ) * +` among them), then one final byte.
      j = i + 1;
      while (j < n && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j += 1;
      if (j < n && text.charCodeAt(j) >= 0x30 && text.charCodeAt(j) <= 0x7e) j += 1;
    }
    // else: a lone or trailing ESC, or one before a control byte (a newline stays), drops just the ESC (j = i + 1).
    else j = i + 1;
    i = j;
    from = j;
  }
  push(text.slice(from));
  return { runs, sgr };
}
