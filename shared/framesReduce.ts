// The box frames recipe's REDUCER and the receiver's CHECK (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.2; the capture owner's calls 1549 and 1558, and its yes
// to packet 2 with its corrected rule 2). L0, pure: imports only `shared/` siblings, and no `node:*` module. The private-name
// matcher (`shared/private-names.mjs#hitsIn`, which needs `node:crypto`) is INJECTED by each caller as `scan`: the runner
// on the test box, and the lane and the read on the server.
//
// - `reduceFrame` runs ON THE TEST BOX, on the frame the driver read, before anything leaves the capture. The raw frame
//   then goes out of scope and is never written or sent.
// - `checkReducedFrame` is its own check, run by the server before the lane stores a frame and again before the read
//   serves one: every refusing rule, and `reduceFrame` with no box-side list must leave the text as it is. One function,
//   the reducer's, never a copy (the owner's condition 1).
//
// A frame the reducer cannot clear is REFUSED WHOLE with its rule word. Nothing is ever cut out to make one pass.
import { CREDENTIAL_MASKS } from './api.js';
import { frameTextFits, stripFrameSgr, type FramesPane, type FramesRefusal } from './framesResult.js';
import { CLASSES } from './models.js';

/** Whitespace erased, as `server/src/inject/send.ts`'s `squash` reads a box row: wrapping moves only spaces. */
const squash = (s: string): string => s.replace(/\s+/g, '');

/** THE DECORATION LIST (the owner's corrected rule 2): the characters a row may carry around our text at its two ends and
 *  still be ours. The box's and a card's border characters, the prompt glyph (and its older `>`), the turn markers and
 *  spaces. A closed list, no pattern: a character not on it is foreign. */
export const FRAMES_DECORATION: readonly string[] = Object.freeze([
  '│', '╭', '╮', '╰', '╯', '❯', '>', '⏺', '●', '⎿', ' ', ' ',
]);
const DECOR = new Set(FRAMES_DECORATION);

/** A row's three spans by code point: the decoration it starts with, its content, the decoration it ends with. */
function spans(row: string): { readonly lead: string; readonly content: string; readonly tail: string } {
  const cps = Array.from(row);
  let a = 0;
  while (a < cps.length && DECOR.has(cps[a]!)) a++;
  let b = cps.length;
  while (b > a && DECOR.has(cps[b - 1]!)) b--;
  return { lead: cps.slice(0, a).join(''), content: cps.slice(a, b).join(''), tail: cps.slice(b).join('') };
}

/** RULE 2: a row is ours when, SGR removed and the decoration stripped from its two ends, what is left is not empty and,
 *  squashed, is a run of one of `ours` (squashed). One foreign character anywhere and it is not. A wrapped turn's
 *  fragment is a run of our text, so it is ours. */
export function rowIsOurs(plainRow: string, oursSquashed: readonly string[]): boolean {
  const left = squash(spans(plainRow).content);
  return left !== '' && oursSquashed.some((o) => o.includes(left));
}

/** A rule row: a run of 10 or more `─`. Its label is kept byte for byte (rule 7). */
const RULE_RUN = /─{10,}/;
export const isRuleRow = (plainRow: string): boolean => RULE_RUN.test(plainRow);

/** RULE 8's one text: what the capture's status line prints, the recorder's `STATUSLINE_REPLY`
 *  (`agent/src/testbox/captureRecord.ts`). Held here, once, for both hosts: the server's check must know it and cannot import
 *  agent code. The recorder keeps its own literal, a legitimately different copy across a process boundary (it runs as its
 *  own type-stripped process and imports no local module), and `testbox-capture-frames-run.test.ts` holds the two equal. */
export const FRAMES_STATUS_TEXT = 'ccrc capture';

/** RULE 8, THE STATUS POSITION (review 4069's F3, the capture owner's condition, the coordinator's rule): the row directly
 *  under the frame's LOWEST rule row, which in a box frame is the box's lower rule, where a configured status line is drawn
 *  (measured on the recorded 2.1.291 panes). It fails closed: that row, spaces trimmed, must be exactly
 *  `FRAMES_STATUS_TEXT`, and no later row may hold the text again; a blank or missing row there refuses too. A frame with
 *  no rule row has no box and so no status position, and it is refused too (the coordinator's change 1, 39557): every
 *  recipe case draws the input box between its rules. Answers the status row's index, or `refused`. */
export function statusRowOf(plainRows: readonly string[]): number | 'refused' {
  let low = -1;
  plainRows.forEach((p, i) => { if (isRuleRow(p)) low = i; });
  if (low < 0) return 'refused';
  const at = low + 1;
  if (at >= plainRows.length || plainRows[at]!.trim() !== FRAMES_STATUS_TEXT) return 'refused';
  for (let i = at + 1; i < plainRows.length; i++) if (plainRows[i]!.includes(FRAMES_STATUS_TEXT)) return 'refused';
  return at;
}

/** RULE 4: a path-like run, whole or cut short (the owner's condition 2). It is two or more components around `/`, a
 *  leading `/` before two components, or an ellipsis or a home mark followed by `/`. */
export const PATH_LIKE = /(?:[\w.-]+\/){2,}|(?:\/[\w.-]+){2,}|(?:…|\.\.\.|~)\//;

/** RULE 5: a model's name, as a word, case-insensitive (the stand-in's own model name included). The classes are
 *  `shared/models.ts`'s `CLASSES`, never a second list of them. */
export const MODEL_WORD = new RegExp(String.raw`\b(?:${CLASSES.join('|')}|claude-[a-z0-9.-]+|ccrc-capture-stand-in)\b`, 'i');

/** RULE 6: an account or a plan. */
export const ACCOUNT_WORD = /api usage billing|\bclaude (?:pro|max|team|enterprise)\b|\borganization\b|\baccount\b|\bplan\b|@[a-z0-9-]+\.[a-z]/i;

/** The fixed texts a replaced row's content becomes. */
export const FRAMES_REPLACED = Object.freeze({ cwd: '‹working directory›', model: '‹model›', account: '‹account›' });
const TOKENS: readonly string[] = Object.values(FRAMES_REPLACED);

/** A private string of at most this many code points (a short user or host name) is matched as a whole word (the
 *  coordinator's ruling on review 4069's F4): bounded on each side by the text's edge or by a character that is not a
 *  letter, digit, dot, dash or underscore. A longer one is matched anywhere. No name is dropped. */
export const FRAMES_SHORT_PRIVATE_MAX = 3;
const WORD_BEFORE = /[\p{L}\p{N}._-]$/u;
const WORD_AFTER = /^[\p{L}\p{N}._-]/u;

/** Every index (in code units) at which `p` occurs in `text` as the reducer counts an occurrence. */
function privateAt(text: string, p: string): number[] {
  const short = Array.from(p).length <= FRAMES_SHORT_PRIVATE_MAX;
  const out: number[] = [];
  for (let i = text.indexOf(p); i !== -1; i = text.indexOf(p, i + 1)) {
    const j = i + p.length;
    if (!short || (!WORD_BEFORE.test(text.slice(Math.max(0, i - 2), i)) && !WORD_AFTER.test(text.slice(j, j + 2)))) out.push(i);
  }
  return out;
}
/** Whether `text` holds one of `privates`, counted as `privateAt` counts it. */
export const holdsPrivate = (text: string, privates: readonly string[]): boolean => privates.some((p) => privateAt(text, p).length > 0);

/** A row less the decoration at its end, and a row less the decoration at its start. */
const lessTail = (row: string): string => { const s = spans(row); return s.lead + s.content; };
const lessLead = (row: string): string => { const s = spans(row); return s.content + s.tail; };

/** THE WRAP RULE, on the box (review 4069's F2): a private string whose head ends one row and whose tail starts the next,
 *  at any split point, read on the rows as drawn and again with the decoration at the break stripped, so padding or a
 *  border between the halves does not hide it. SGR is already gone from both rows, so a colour change between the halves
 *  does not either. A wrap through a private string means the pane is not laid out as the recipe expects: the frame is
 *  refused whole, never repaired. */
function privateAcross(a: string, b: string, privates: readonly string[]): boolean {
  for (const [x, y] of [[a, b], [lessTail(a), lessLead(b)]] as const) {
    const joined = x + y;
    for (const p of privates) if (privateAt(joined, p).some((i) => i < x.length && i + p.length > x.length)) return true;
  }
  return false;
}

/** The first run of a row's content (after its leading decoration), and whether it reads as the tail of a path: it
 *  holds a `/`. */
const pathTail = (row: string): boolean => (/^\S+/u.exec(spans(row).content)?.[0] ?? '').includes('/');

/** THE WIDE TABLE (review 4109's R1, the coordinator's ruling 1 on wave 195): every code point whose East Asian Width is
 *  W (Wide) or F (Fullwidth) in the Unicode Character Database file EastAsianWidth-17.0.0.txt, adjacent ranges merged, as
 *  inclusive `[first, last]` pairs in code point order. GENERATED, never edited by hand: the fixture
 *  `server/test/fixtures/unicode-east-asian-width.txt` holds that file's W and F lines verbatim, and the table case in
 *  `server/test/frames-reduce.test.ts` parses and merges them, prints this table's source text from them, and fails unless
 *  this table is that text, so the two cannot drift: a new data file version is a new fixture, and the case's own expected
 *  text is what goes here. Numbers, not regular expression escapes, so the table is ASCII by construction (a case holds
 *  that too). The engine's regular expressions have no East Asian Width property, so no property escape can stand in. */
export const FRAMES_WIDE_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  [0x1100, 0x115F], [0x231A, 0x231B], [0x2329, 0x232A], [0x23E9, 0x23EC], [0x23F0, 0x23F0], [0x23F3, 0x23F3], [0x25FD, 0x25FE], [0x2614, 0x2615],
  [0x2630, 0x2637], [0x2648, 0x2653], [0x267F, 0x267F], [0x268A, 0x268F], [0x2693, 0x2693], [0x26A1, 0x26A1], [0x26AA, 0x26AB], [0x26BD, 0x26BE],
  [0x26C4, 0x26C5], [0x26CE, 0x26CE], [0x26D4, 0x26D4], [0x26EA, 0x26EA], [0x26F2, 0x26F3], [0x26F5, 0x26F5], [0x26FA, 0x26FA], [0x26FD, 0x26FD],
  [0x2705, 0x2705], [0x270A, 0x270B], [0x2728, 0x2728], [0x274C, 0x274C], [0x274E, 0x274E], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797],
  [0x27B0, 0x27B0], [0x27BF, 0x27BF], [0x2B1B, 0x2B1C], [0x2B50, 0x2B50], [0x2B55, 0x2B55], [0x2E80, 0x2E99], [0x2E9B, 0x2EF3], [0x2F00, 0x2FD5],
  [0x2FF0, 0x303E], [0x3041, 0x3096], [0x3099, 0x30FF], [0x3105, 0x312F], [0x3131, 0x318E], [0x3190, 0x31E5], [0x31EF, 0x321E], [0x3220, 0x3247],
  [0x3250, 0xA48C], [0xA490, 0xA4C6], [0xA960, 0xA97C], [0xAC00, 0xD7A3], [0xF900, 0xFAFF], [0xFE10, 0xFE19], [0xFE30, 0xFE52], [0xFE54, 0xFE66],
  [0xFE68, 0xFE6B], [0xFF01, 0xFF60], [0xFFE0, 0xFFE6], [0x16FE0, 0x16FE4], [0x16FF0, 0x16FF6], [0x17000, 0x18CD5], [0x18CFF, 0x18D1E], [0x18D80, 0x18DF2],
  [0x1AFF0, 0x1AFF3], [0x1AFF5, 0x1AFFB], [0x1AFFD, 0x1AFFE], [0x1B000, 0x1B122], [0x1B132, 0x1B132], [0x1B150, 0x1B152], [0x1B155, 0x1B155], [0x1B164, 0x1B167],
  [0x1B170, 0x1B2FB], [0x1D300, 0x1D356], [0x1D360, 0x1D376], [0x1F004, 0x1F004], [0x1F0CF, 0x1F0CF], [0x1F18E, 0x1F18E], [0x1F191, 0x1F19A], [0x1F200, 0x1F202],
  [0x1F210, 0x1F23B], [0x1F240, 0x1F248], [0x1F250, 0x1F251], [0x1F260, 0x1F265], [0x1F300, 0x1F320], [0x1F32D, 0x1F335], [0x1F337, 0x1F37C], [0x1F37E, 0x1F393],
  [0x1F3A0, 0x1F3CA], [0x1F3CF, 0x1F3D3], [0x1F3E0, 0x1F3F0], [0x1F3F4, 0x1F3F4], [0x1F3F8, 0x1F43E], [0x1F440, 0x1F440], [0x1F442, 0x1F4FC], [0x1F4FF, 0x1F53D],
  [0x1F54B, 0x1F54E], [0x1F550, 0x1F567], [0x1F57A, 0x1F57A], [0x1F595, 0x1F596], [0x1F5A4, 0x1F5A4], [0x1F5FB, 0x1F64F], [0x1F680, 0x1F6C5], [0x1F6CC, 0x1F6CC],
  [0x1F6D0, 0x1F6D2], [0x1F6D5, 0x1F6D8], [0x1F6DC, 0x1F6DF], [0x1F6EB, 0x1F6EC], [0x1F6F4, 0x1F6FC], [0x1F7E0, 0x1F7EB], [0x1F7F0, 0x1F7F0], [0x1F90C, 0x1F93A],
  [0x1F93C, 0x1F945], [0x1F947, 0x1F9FF], [0x1FA70, 0x1FA7C], [0x1FA80, 0x1FA8A], [0x1FA8E, 0x1FAC6], [0x1FAC8, 0x1FAC8], [0x1FACD, 0x1FADC], [0x1FADF, 0x1FAEA],
  [0x1FAEF, 0x1FAF8], [0x20000, 0x2FFFD], [0x30000, 0x3FFFD],
]);
/** The engine's own classes that count two cells beside the table: an emoji drawn as one (`Emoji_Presentation`, which
 *  takes in the regional indicators the table gives N), and an UNASSIGNED code point (`Cn`, the noncharacters included).
 *
 *  UNKNOWN IS WIDE ON PURPOSE (ruling 2): the class rule (`FRAME_REFUSED_CHARS`, rule 1) lets an unassigned code point
 *  through, and nothing can say how a terminal draws one, so it counts two cells, the direction in which the full-width
 *  rule fires. A PRIVATE-USE code point (`Co`) never reaches the width: rule 1 refuses the frame whole (`not-a-frame`)
 *  first, as it does a surrogate, a control and a format character. Were it asked, a private-use code point would count
 *  one cell (the data file gives it A). An engine on an older Unicode version reads more code points as unassigned and so
 *  counts them wider, the safe direction; a case holds that the engine is not newer than the table's version. */
const WIDE_CLASS = /\p{Emoji_Presentation}|\p{Cn}/u;
/** How many screen cells one character (one code point) takes: two when the table lists it, when it is an emoji drawn as
 *  one, or when it is unassigned; one otherwise. One-cell characters include the ambiguous-width ones (A), which a
 *  terminal draws in one cell outside an East Asian locale (the frames driver runs under `LANG=C.UTF-8`, read in
 *  `agent/src/testbox/captureFramesRun.ts`; how the terminal draws them is inferred, not measured), and every combining
 *  or zero-width mark, which counts one though it is drawn in none: a row is read as wider than it is drawn there, never
 *  narrower. */
export function frameCellWidth(c: string): 1 | 2 {
  const cp = c.codePointAt(0) ?? 0;
  let lo = 0;
  let hi = FRAMES_WIDE_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = FRAMES_WIDE_RANGES[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return 2;
  }
  return WIDE_CLASS.test(c) ? 2 : 1;
}
/** A row's width in screen cells. */
const cellsOf = (cps: readonly string[]): number => cps.reduce((n, c) => n + frameCellWidth(c), 0);

/** Whether a row's text runs to its last column (review 4086's F-B, review 4109's R1): measured in screen cells AFTER its
 *  trailing spaces are dropped, its last character is neither the decoration nor a rule's `─`, and it either fills the
 *  pane's width, or it ends ONE CELL SHORT and the next row begins with a wide character. That is a STRADDLE: a wide
 *  character that does not fit in the last cell is wrapped whole to the next row, and the last cell is left blank, which
 *  a read of the pane may give as a trailing space or as nothing (ruling 3). Measured on the row as drawn, a row that
 *  keeps that blank cell as a space would read as full but ending in a space, and the rule would keep the path it
 *  continues: the wrong direction. */
export function runsToTheEdge(row: string, next: string, pane: FramesPane): boolean {
  const cps = Array.from(row.replace(/\s+$/u, ''));
  const last = cps[cps.length - 1];
  if (last === undefined || DECOR.has(last) || last === '─') return false;
  const cells = cellsOf(cps);
  const first = Array.from(next)[0];
  return cells >= pane.cols || (cells === pane.cols - 1 && first !== undefined && frameCellWidth(first) === 2);
}

/** THE FULL-WIDTH RULE, on both hosts (review 4069's F2): a token holding a `/` that runs to a full-width row's last
 *  column, or to the cell before a straddling wide character, and goes on at the start of the next row, which is not ours
 *  and not a rule row. The pane wrapped a path: refused whole. */
function pathOffTheEdge(a: string, b: string, pane: FramesPane): boolean {
  if (!runsToTheEdge(a, b, pane)) return false;
  // The head is read where the edge was measured: after the trailing spaces a straddle's blank cell may leave.
  const head = /\S+$/u.exec(a.replace(/\s+$/u, ''))?.[0] ?? '';
  const tail = /^\S+/u.exec(spans(b).content)?.[0] ?? '';
  return tail !== '' && (head + tail).includes('/');
}

/** Each token less its opening quote (what follows a `‹`), and less its closing quote (what precedes a `›`). */
const AFTER_OPEN: readonly string[] = TOKENS.map((t) => t.slice(1));
const BEFORE_CLOSE: readonly string[] = TOKENS.map((t) => t.slice(0, -1));
/** How many code units of `s` follow `plain` from `i` on, and precede it up to `j`. */
const leadOf = (plain: string, i: number, s: string): number => { let k = 0; while (k < s.length && plain[i + k] === s[k]) k++; return k; };
const trailOf = (plain: string, j: number, s: string): number => { let k = 0; while (k < s.length && plain[j - 1 - k] === s[s.length - 1 - k]) k++; return k; };

/** THE SHAPE CHECKS ON A REDUCED TEXT, on both hosts, so the server, which has none of the box's strings, refuses by shape
 *  what a wrap left (review 4069's F2, the reviewer's two measured frames and their class): a replacement token cut, and a
 *  path's tail at the start of the row after a row that ends in a replacement token. A path's tail after a row run to the
 *  edge is the full-width rule's, which runs on both hosts too.
 *
 *  The cut is EXACT (the coordinator's ruling on review 4086's F-A): the opening quote followed by a non-empty part of the
 *  start of a token's name that does not go on to the whole token, or a non-empty part of the end of a name followed by the
 *  closing quote and not preceded by the rest of the token. The quotes are Claude Code's own glyphs too (it draws a held
 *  stash as a row that begins `› stashed`), so a bare quote, with no part of a token's name against it, is kept. The
 *  token names begin with three different letters and end with three different letters, so at most one name is against a
 *  quote. A row too narrow for its whole token is refused where it would be replaced (`reduceFrame`). */
function cutToken(plain: string): boolean {
  for (let i = plain.indexOf('‹'); i !== -1; i = plain.indexOf('‹', i + 1)) {
    if (AFTER_OPEN.some((s) => { const k = leadOf(plain, i + 1, s); return k > 0 && k < s.length; })) return true;
  }
  for (let j = plain.indexOf('›'); j !== -1; j = plain.indexOf('›', j + 1)) {
    if (BEFORE_CLOSE.some((s) => { const k = trailOf(plain, j, s); return k > 0 && k < s.length; })) return true;
  }
  return false;
}
const endsInToken = (row: string): boolean => TOKENS.some((t) => lessTail(row).endsWith(t));

/** A row with its content replaced by `token`, padded with spaces to the content's width, its two decoration spans kept,
 *  its SGR gone with its content: every row keeps its width on screen, both measured in screen cells (review 4109's F5),
 *  so a content of wide characters is as wide as it is drawn. `null` when the content is narrower than the token: a token
 *  is never cut short to fit (review 4069's F2), so the frame is refused. */
function replaced(plainRow: string, token: string): string | null {
  const s = spans(plainRow);
  const w = cellsOf(Array.from(s.content));
  const t = cellsOf(Array.from(token));
  return w < t ? null : s.lead + token + ' '.repeat(w - t) + s.tail;
}

/** RULE 9's private shapes, on rows not ours, after reduction: an absolute path under a home or a mount, a home-relative
 *  path, an email, an IPv4 address other than loopback, a dotted host name with a public suffix, and a run of 32 or more
 *  hex characters (an id or a token). */
export const PRIVATE_SHAPES: readonly RegExp[] = Object.freeze([
  /\/(?:home|Users|root|mnt)(?:\/|\b)/, /~\//, /[\w.+-]+@[\w-]+\.[\w.-]+/,
  /\b(?!127\.0\.0\.1\b)(?:\d{1,3}\.){3}\d{1,3}\b/,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|ai|app|cloud|ts\.net|duckdns\.org)\b/i,
  /[0-9a-f]{32,}/i,
]);

/** RULE 9's masker shapes on the test box: the product masker's credential shapes, from their one home. */
const CREDENTIAL_RES: readonly RegExp[] = CREDENTIAL_MASKS.map((m) => new RegExp(m.source));
/** Whether the product masker's shapes would change `text`. */
export const credentialShaped = (text: string): boolean => CREDENTIAL_RES.some((r) => r.test(text));

/** The committed private-name matcher, as each caller composes it: `true` when it hits anything in `text`. */
export type FramesScan = (text: string) => boolean;

/** What `reduceFrame` decided, with how many rows each rule replaced (the owner's wave-done ask). */
export type ReduceAnswer =
  | { readonly kind: 'reduced'; readonly text: string; readonly replaced: { readonly cwd: number; readonly path: number; readonly model: number; readonly account: number } }
  | { readonly kind: 'refused'; readonly refusal: FramesRefusal };

/** THE REDUCER, rules 1 to 9 (plan 5.2). `ours`: the case's fixed texts (`framesCapture.ts#framesOurs`). `privates`: the
 *  exact strings this capture knows (none on the server). `scan`: the committed matcher. `mask`: whether the product's
 *  masker would change a text: its shapes on the box (the default), the live masker on the server. */
export function reduceFrame(
  frame: string, pane: FramesPane, ours: readonly string[], privates: readonly string[], scan: FramesScan, mask: (t: string) => boolean = credentialShaped,
): ReduceAnswer {
  // Rule 1: the shape gate.
  if (!frameTextFits(frame, pane)) return { kind: 'refused', refusal: 'not-a-frame' };
  const oursSq = ours.map(squash).filter((o) => o !== '');
  const priv = privates.filter((p) => p !== '');
  const count = { cwd: 0, path: 0, model: 0, account: 0 };
  const scanned: string[] = [];
  let ruleLeak = false;
  let narrow = false;
  /** `replaced`, with a row too narrow for its token marked, so the frame is refused below. */
  const replace = (plain: string, token: string): string => { const r = replaced(plain, token); if (r === null) { narrow = true; return plain; } return r; };
  const drawn = frame.split('\n');
  const plains = drawn.map(stripFrameSgr);
  // Rule 8: the status position holds exactly the capture's status text, which is then ours; anything else refuses whole.
  const status = statusRowOf(plains);
  if (status === 'refused') return { kind: 'refused', refusal: 'status-row' };
  // The wrap rule (box only: it needs the box's strings) and the full-width rule, on the rows as drawn, SGR removed.
  for (let i = 0; i + 1 < plains.length; i++) {
    const [a, b] = [plains[i]!, plains[i + 1]!];
    if (priv.length > 0 && privateAcross(a, b, priv)) return { kind: 'refused', refusal: 'private-shape' };
    if (!isRuleRow(b) && !rowIsOurs(b, oursSq) && pathOffTheEdge(a, b, pane)) return { kind: 'refused', refusal: 'private-shape' };
  }
  const ourRow = plains.map((p, i) => i === status || (!isRuleRow(p) && rowIsOurs(p, oursSq)));
  const rows = drawn.map((row, i) => {
    const plain = plains[i]!;
    const hasPrivate = holdsPrivate(plain, priv);
    if (isRuleRow(plain)) {
      // Rule 7: a rule row's label is kept byte for byte, unless it holds a private string. A label rules 4 to 6 would
      // catch is never kept and never rewritten: the frame is refused (below), so a cut-short path, a model or a plan
      // cannot ride a rule row out of the box (the security review of F3).
      if (hasPrivate) { count.cwd++; return replace(plain, FRAMES_REPLACED.cwd); }
      if (PATH_LIKE.test(plain) || MODEL_WORD.test(plain) || ACCOUNT_WORD.test(plain)) ruleLeak = true;
      scanned.push(plain);
      return row;
    }
    // Rule 2: our rows stay byte for byte.
    if (ourRow[i]) return row;
    let out: string | null = null;
    if (hasPrivate) { count.cwd++; out = replace(plain, FRAMES_REPLACED.cwd); } // rule 3
    else if (PATH_LIKE.test(plain)) { count.path++; out = replace(plain, FRAMES_REPLACED.cwd); } // rule 4
    else if (MODEL_WORD.test(plain)) { count.model++; out = replace(plain, FRAMES_REPLACED.model); } // rule 5
    else if (ACCOUNT_WORD.test(plain)) { count.account++; out = replace(plain, FRAMES_REPLACED.account); } // rule 6
    // Rule 8 judged the status row above (it is ours once it is exactly the capture's text). Any other row below the box
    // is read by rules 3 to 6 like any other.
    scanned.push(out ?? plain);
    return out ?? row;
  });
  // A row too narrow for its whole token: the frame is refused, never a token cut short.
  if (narrow) return { kind: 'refused', refusal: 'private-shape' };
  const text = rows.join('\n');
  // The shape checks on the reduced rows: no cut token, no path's tail after a token.
  const outPlain = rows.map(stripFrameSgr);
  if (outPlain.some(cutToken)) return { kind: 'refused', refusal: 'private-shape' };
  for (let i = 0; i + 1 < outPlain.length; i++) {
    const [a, b] = [outPlain[i]!, outPlain[i + 1]!];
    if (!ourRow[i + 1] && !isRuleRow(b) && pathTail(b) && endsInToken(a)) return { kind: 'refused', refusal: 'private-shape' };
  }
  // Rule 9: the scans over every row not ours, then the masker's over the whole frame. A hit refuses it whole.
  const foreign = scanned.join('\n');
  if (scan(foreign)) return { kind: 'refused', refusal: 'private-name' };
  if (ruleLeak || PRIVATE_SHAPES.some((r) => r.test(foreign)) || holdsPrivate(foreign, priv)) return { kind: 'refused', refusal: 'private-shape' };
  // The masker over the whole frame as drawn AND with its SGR removed, so a colour change inside a key cannot split it
  // past the shapes (the security review of F3).
  if (mask(text) || mask(stripFrameSgr(text))) return { kind: 'refused', refusal: 'masked' };
  return { kind: 'reduced', text, replaced: count };
}

/** THE RECEIVER'S CHECK (the owner's condition 1): the reducer's own rules on a text that is already reduced, with no
 *  box-side list. Clear only when the reducer refuses nothing and leaves the text as it is; a text a rule would still
 *  replace is a private shape left in it. */
export function checkReducedFrame(
  text: string, pane: FramesPane, ours: readonly string[], scan: FramesScan, mask: (t: string) => boolean = credentialShaped,
): { readonly ok: true } | { readonly ok: false; readonly refusal: FramesRefusal } {
  const r = reduceFrame(text, pane, ours, [], scan, mask);
  if (r.kind === 'refused') return { ok: false, refusal: r.refusal };
  return r.text === text ? { ok: true } : { ok: false, refusal: 'private-shape' };
}

/** What the reducer answers on a fixed probe table, folded into the recipe's version (`framesCapture.ts`), so a change in
 *  what the reducer does changes the version and a change in how it is spelled does not. */
export function reducerFingerprint(): string {
  const pane = { cols: 40, rows: 6 };
  const none: FramesScan = () => false;
  const probes = [
    '❯ ours text here', '│ /work/a/b and more │', 'see …/x/y here', 'Haiku 9 · Claude Max', 'Claude Pro account', '──────────── ↑ 9 more ──',
    'mail a@b.example.com', 'host 10.1.2.3', 'tok ' + 'a'.repeat(32), 'sk-ant-api03-abcdefghij', 'plain row', '\x1b]8;;x\x1b\\',
    'a\u2066b', 'see ‹model here', 'logged as bo now and', 'at /secr\net/x more', '‹model›\nx/y tail', '~/x',
    // Review 4109's F9: a bare quote (kept), a wide character reaching the edge (a Hangul syllable, which the table lists),
    // a row at the probe's own width, and a straddle (a row one cell short, the next beginning with a wide character).
    '› stashed · Restart to update', String.fromCodePoint(0xAC00).repeat(17) + 'xy /ab\ncd rest',
    'x'.repeat(35) + ' /pro\nject rest', 'x'.repeat(35) + ' /pr\n' + String.fromCodePoint(0x6F22) + 'ject rest',
  ];
  // Each probe drawn as a box draws it: between two rules, the capture's status row under the lower one (rule 8). And the
  // status rule's own probes: no rule, another status text, the text twice.
  const rule = '─'.repeat(12);
  const boxed = (p: string): string => `${rule}\n${p}\n${rule}\n  ${FRAMES_STATUS_TEXT}\n`;
  const status = ['plain row\n', `${rule}\n  other status\n`, `${rule}\n  ${FRAMES_STATUS_TEXT}\n  ${FRAMES_STATUS_TEXT}\n`];
  return JSON.stringify([...probes.map(boxed), ...status].map((f) => reduceFrame(f, pane, ['ours text here'], ['/secret/x', 'bo'], none)));
}
