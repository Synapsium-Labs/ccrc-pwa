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

/** The first run of a row's content (after its leading decoration and any further leading whitespace), and whether it
 *  reads as the tail of a path: it holds a `/`. The whitespace skip is review 4168's F1: a content that begins with a
 *  Unicode space off the decoration list (U+3000, U+2000 to U+200A, U+202F, U+205F, U+1680) read as no run at all, so a
 *  path after it was kept. Those spaces stay off the decoration list, so the straddle test still sees U+3000 first. */
const pathTail = (row: string): boolean => (/^\s*(\S+)/u.exec(spans(row).content)?.[1] ?? '').includes('/');

/** THE ONE-CELL TABLE (review 4109's R1, the coordinator's rulings 1 and 2 on wave 195, and on review 4133's F2): every
 *  code point the Unicode Character Database file EastAsianWidth-17.0.0.txt lists as N (neutral), Na (narrow), H
 *  (halfwidth) or A (ambiguous), adjacent ranges merged, as inclusive `[first, last]` pairs in code point order. Every
 *  other code point counts two cells: what the file lists as W (wide) or F (fullwidth), and what it does not list at all.
 *  Every unlisted code point is unassigned in Unicode 17.0 (the file lists every assigned one), but not every unassigned
 *  one is unlisted: the file also lists 56,166 unassigned code points, all as W (reserved ranges of the CJK blocks and
 *  planes 2 and 3), so they count two cells as well. So UNKNOWN IS RELATIVE TO
 *  THE TABLE, NEVER TO THE ENGINE: the answer for a code point is the same on every engine version, and a code point
 *  assigned after 17.0 counts two cells until a newer data file says otherwise.
 *
 *  GENERATED, never edited by hand: the fixture `server/test/fixtures/unicode-east-asian-width.txt` IS that public data
 *  file, byte for byte (a case pins its sha256), and the table case in `server/test/frames-reduce.test.ts` parses it,
 *  merges the one-cell lines, prints this table's source text from them, and fails unless this table is that text, so
 *  the two cannot drift: a new data file version is a new fixture, and the case's own expected text is what goes here.
 *  Numbers, not regular expression escapes, so the table is ASCII by construction (a case holds that too). The engine's
 *  regular expressions have no East Asian Width property, so no property escape can stand in. */
export const FRAMES_ONE_CELL_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  [0x0000, 0x0377], [0x037A, 0x037F], [0x0384, 0x038A], [0x038C, 0x038C], [0x038E, 0x03A1], [0x03A3, 0x052F], [0x0531, 0x0556], [0x0559, 0x058A],
  [0x058D, 0x058F], [0x0591, 0x05C7], [0x05D0, 0x05EA], [0x05EF, 0x05F4], [0x0600, 0x070D], [0x070F, 0x074A], [0x074D, 0x07B1], [0x07C0, 0x07FA],
  [0x07FD, 0x082D], [0x0830, 0x083E], [0x0840, 0x085B], [0x085E, 0x085E], [0x0860, 0x086A], [0x0870, 0x0891], [0x0897, 0x0983], [0x0985, 0x098C],
  [0x098F, 0x0990], [0x0993, 0x09A8], [0x09AA, 0x09B0], [0x09B2, 0x09B2], [0x09B6, 0x09B9], [0x09BC, 0x09C4], [0x09C7, 0x09C8], [0x09CB, 0x09CE],
  [0x09D7, 0x09D7], [0x09DC, 0x09DD], [0x09DF, 0x09E3], [0x09E6, 0x09FE], [0x0A01, 0x0A03], [0x0A05, 0x0A0A], [0x0A0F, 0x0A10], [0x0A13, 0x0A28],
  [0x0A2A, 0x0A30], [0x0A32, 0x0A33], [0x0A35, 0x0A36], [0x0A38, 0x0A39], [0x0A3C, 0x0A3C], [0x0A3E, 0x0A42], [0x0A47, 0x0A48], [0x0A4B, 0x0A4D],
  [0x0A51, 0x0A51], [0x0A59, 0x0A5C], [0x0A5E, 0x0A5E], [0x0A66, 0x0A76], [0x0A81, 0x0A83], [0x0A85, 0x0A8D], [0x0A8F, 0x0A91], [0x0A93, 0x0AA8],
  [0x0AAA, 0x0AB0], [0x0AB2, 0x0AB3], [0x0AB5, 0x0AB9], [0x0ABC, 0x0AC5], [0x0AC7, 0x0AC9], [0x0ACB, 0x0ACD], [0x0AD0, 0x0AD0], [0x0AE0, 0x0AE3],
  [0x0AE6, 0x0AF1], [0x0AF9, 0x0AFF], [0x0B01, 0x0B03], [0x0B05, 0x0B0C], [0x0B0F, 0x0B10], [0x0B13, 0x0B28], [0x0B2A, 0x0B30], [0x0B32, 0x0B33],
  [0x0B35, 0x0B39], [0x0B3C, 0x0B44], [0x0B47, 0x0B48], [0x0B4B, 0x0B4D], [0x0B55, 0x0B57], [0x0B5C, 0x0B5D], [0x0B5F, 0x0B63], [0x0B66, 0x0B77],
  [0x0B82, 0x0B83], [0x0B85, 0x0B8A], [0x0B8E, 0x0B90], [0x0B92, 0x0B95], [0x0B99, 0x0B9A], [0x0B9C, 0x0B9C], [0x0B9E, 0x0B9F], [0x0BA3, 0x0BA4],
  [0x0BA8, 0x0BAA], [0x0BAE, 0x0BB9], [0x0BBE, 0x0BC2], [0x0BC6, 0x0BC8], [0x0BCA, 0x0BCD], [0x0BD0, 0x0BD0], [0x0BD7, 0x0BD7], [0x0BE6, 0x0BFA],
  [0x0C00, 0x0C0C], [0x0C0E, 0x0C10], [0x0C12, 0x0C28], [0x0C2A, 0x0C39], [0x0C3C, 0x0C44], [0x0C46, 0x0C48], [0x0C4A, 0x0C4D], [0x0C55, 0x0C56],
  [0x0C58, 0x0C5A], [0x0C5C, 0x0C5D], [0x0C60, 0x0C63], [0x0C66, 0x0C6F], [0x0C77, 0x0C8C], [0x0C8E, 0x0C90], [0x0C92, 0x0CA8], [0x0CAA, 0x0CB3],
  [0x0CB5, 0x0CB9], [0x0CBC, 0x0CC4], [0x0CC6, 0x0CC8], [0x0CCA, 0x0CCD], [0x0CD5, 0x0CD6], [0x0CDC, 0x0CDE], [0x0CE0, 0x0CE3], [0x0CE6, 0x0CEF],
  [0x0CF1, 0x0CF3], [0x0D00, 0x0D0C], [0x0D0E, 0x0D10], [0x0D12, 0x0D44], [0x0D46, 0x0D48], [0x0D4A, 0x0D4F], [0x0D54, 0x0D63], [0x0D66, 0x0D7F],
  [0x0D81, 0x0D83], [0x0D85, 0x0D96], [0x0D9A, 0x0DB1], [0x0DB3, 0x0DBB], [0x0DBD, 0x0DBD], [0x0DC0, 0x0DC6], [0x0DCA, 0x0DCA], [0x0DCF, 0x0DD4],
  [0x0DD6, 0x0DD6], [0x0DD8, 0x0DDF], [0x0DE6, 0x0DEF], [0x0DF2, 0x0DF4], [0x0E01, 0x0E3A], [0x0E3F, 0x0E5B], [0x0E81, 0x0E82], [0x0E84, 0x0E84],
  [0x0E86, 0x0E8A], [0x0E8C, 0x0EA3], [0x0EA5, 0x0EA5], [0x0EA7, 0x0EBD], [0x0EC0, 0x0EC4], [0x0EC6, 0x0EC6], [0x0EC8, 0x0ECE], [0x0ED0, 0x0ED9],
  [0x0EDC, 0x0EDF], [0x0F00, 0x0F47], [0x0F49, 0x0F6C], [0x0F71, 0x0F97], [0x0F99, 0x0FBC], [0x0FBE, 0x0FCC], [0x0FCE, 0x0FDA], [0x1000, 0x10C5],
  [0x10C7, 0x10C7], [0x10CD, 0x10CD], [0x10D0, 0x10FF], [0x1160, 0x1248], [0x124A, 0x124D], [0x1250, 0x1256], [0x1258, 0x1258], [0x125A, 0x125D],
  [0x1260, 0x1288], [0x128A, 0x128D], [0x1290, 0x12B0], [0x12B2, 0x12B5], [0x12B8, 0x12BE], [0x12C0, 0x12C0], [0x12C2, 0x12C5], [0x12C8, 0x12D6],
  [0x12D8, 0x1310], [0x1312, 0x1315], [0x1318, 0x135A], [0x135D, 0x137C], [0x1380, 0x1399], [0x13A0, 0x13F5], [0x13F8, 0x13FD], [0x1400, 0x169C],
  [0x16A0, 0x16F8], [0x1700, 0x1715], [0x171F, 0x1736], [0x1740, 0x1753], [0x1760, 0x176C], [0x176E, 0x1770], [0x1772, 0x1773], [0x1780, 0x17DD],
  [0x17E0, 0x17E9], [0x17F0, 0x17F9], [0x1800, 0x1819], [0x1820, 0x1878], [0x1880, 0x18AA], [0x18B0, 0x18F5], [0x1900, 0x191E], [0x1920, 0x192B],
  [0x1930, 0x193B], [0x1940, 0x1940], [0x1944, 0x196D], [0x1970, 0x1974], [0x1980, 0x19AB], [0x19B0, 0x19C9], [0x19D0, 0x19DA], [0x19DE, 0x1A1B],
  [0x1A1E, 0x1A5E], [0x1A60, 0x1A7C], [0x1A7F, 0x1A89], [0x1A90, 0x1A99], [0x1AA0, 0x1AAD], [0x1AB0, 0x1ADD], [0x1AE0, 0x1AEB], [0x1B00, 0x1B4C],
  [0x1B4E, 0x1BF3], [0x1BFC, 0x1C37], [0x1C3B, 0x1C49], [0x1C4D, 0x1C8A], [0x1C90, 0x1CBA], [0x1CBD, 0x1CC7], [0x1CD0, 0x1CFA], [0x1D00, 0x1F15],
  [0x1F18, 0x1F1D], [0x1F20, 0x1F45], [0x1F48, 0x1F4D], [0x1F50, 0x1F57], [0x1F59, 0x1F59], [0x1F5B, 0x1F5B], [0x1F5D, 0x1F5D], [0x1F5F, 0x1F7D],
  [0x1F80, 0x1FB4], [0x1FB6, 0x1FC4], [0x1FC6, 0x1FD3], [0x1FD6, 0x1FDB], [0x1FDD, 0x1FEF], [0x1FF2, 0x1FF4], [0x1FF6, 0x1FFE], [0x2000, 0x2064],
  [0x2066, 0x2071], [0x2074, 0x208E], [0x2090, 0x209C], [0x20A0, 0x20C1], [0x20D0, 0x20F0], [0x2100, 0x218B], [0x2190, 0x2319], [0x231C, 0x2328],
  [0x232B, 0x23E8], [0x23ED, 0x23EF], [0x23F1, 0x23F2], [0x23F4, 0x2429], [0x2440, 0x244A], [0x2460, 0x25FC], [0x25FF, 0x2613], [0x2616, 0x262F],
  [0x2638, 0x2647], [0x2654, 0x267E], [0x2680, 0x2689], [0x2690, 0x2692], [0x2694, 0x26A0], [0x26A2, 0x26A9], [0x26AC, 0x26BC], [0x26BF, 0x26C3],
  [0x26C6, 0x26CD], [0x26CF, 0x26D3], [0x26D5, 0x26E9], [0x26EB, 0x26F1], [0x26F4, 0x26F4], [0x26F6, 0x26F9], [0x26FB, 0x26FC], [0x26FE, 0x2704],
  [0x2706, 0x2709], [0x270C, 0x2727], [0x2729, 0x274B], [0x274D, 0x274D], [0x274F, 0x2752], [0x2756, 0x2756], [0x2758, 0x2794], [0x2798, 0x27AF],
  [0x27B1, 0x27BE], [0x27C0, 0x2B1A], [0x2B1D, 0x2B4F], [0x2B51, 0x2B54], [0x2B56, 0x2B73], [0x2B76, 0x2CF3], [0x2CF9, 0x2D25], [0x2D27, 0x2D27],
  [0x2D2D, 0x2D2D], [0x2D30, 0x2D67], [0x2D6F, 0x2D70], [0x2D7F, 0x2D96], [0x2DA0, 0x2DA6], [0x2DA8, 0x2DAE], [0x2DB0, 0x2DB6], [0x2DB8, 0x2DBE],
  [0x2DC0, 0x2DC6], [0x2DC8, 0x2DCE], [0x2DD0, 0x2DD6], [0x2DD8, 0x2DDE], [0x2DE0, 0x2E5D], [0x303F, 0x303F], [0x3248, 0x324F], [0xA4D0, 0xA62B],
  [0xA640, 0xA6F7], [0xA700, 0xA7DC], [0xA7F1, 0xA82C], [0xA830, 0xA839], [0xA840, 0xA877], [0xA880, 0xA8C5], [0xA8CE, 0xA8D9], [0xA8E0, 0xA953],
  [0xA95F, 0xA95F], [0xA980, 0xA9CD], [0xA9CF, 0xA9D9], [0xA9DE, 0xA9FE], [0xAA00, 0xAA36], [0xAA40, 0xAA4D], [0xAA50, 0xAA59], [0xAA5C, 0xAAC2],
  [0xAADB, 0xAAF6], [0xAB01, 0xAB06], [0xAB09, 0xAB0E], [0xAB11, 0xAB16], [0xAB20, 0xAB26], [0xAB28, 0xAB2E], [0xAB30, 0xAB6B], [0xAB70, 0xABED],
  [0xABF0, 0xABF9], [0xD7B0, 0xD7C6], [0xD7CB, 0xD7FB], [0xD800, 0xF8FF], [0xFB00, 0xFB06], [0xFB13, 0xFB17], [0xFB1D, 0xFB36], [0xFB38, 0xFB3C],
  [0xFB3E, 0xFB3E], [0xFB40, 0xFB41], [0xFB43, 0xFB44], [0xFB46, 0xFDCF], [0xFDF0, 0xFE0F], [0xFE20, 0xFE2F], [0xFE70, 0xFE74], [0xFE76, 0xFEFC],
  [0xFEFF, 0xFEFF], [0xFF61, 0xFFBE], [0xFFC2, 0xFFC7], [0xFFCA, 0xFFCF], [0xFFD2, 0xFFD7], [0xFFDA, 0xFFDC], [0xFFE8, 0xFFEE], [0xFFF9, 0xFFFD],
  [0x10000, 0x1000B], [0x1000D, 0x10026], [0x10028, 0x1003A], [0x1003C, 0x1003D], [0x1003F, 0x1004D], [0x10050, 0x1005D], [0x10080, 0x100FA], [0x10100, 0x10102],
  [0x10107, 0x10133], [0x10137, 0x1018E], [0x10190, 0x1019C], [0x101A0, 0x101A0], [0x101D0, 0x101FD], [0x10280, 0x1029C], [0x102A0, 0x102D0], [0x102E0, 0x102FB],
  [0x10300, 0x10323], [0x1032D, 0x1034A], [0x10350, 0x1037A], [0x10380, 0x1039D], [0x1039F, 0x103C3], [0x103C8, 0x103D5], [0x10400, 0x1049D], [0x104A0, 0x104A9],
  [0x104B0, 0x104D3], [0x104D8, 0x104FB], [0x10500, 0x10527], [0x10530, 0x10563], [0x1056F, 0x1057A], [0x1057C, 0x1058A], [0x1058C, 0x10592], [0x10594, 0x10595],
  [0x10597, 0x105A1], [0x105A3, 0x105B1], [0x105B3, 0x105B9], [0x105BB, 0x105BC], [0x105C0, 0x105F3], [0x10600, 0x10736], [0x10740, 0x10755], [0x10760, 0x10767],
  [0x10780, 0x10785], [0x10787, 0x107B0], [0x107B2, 0x107BA], [0x10800, 0x10805], [0x10808, 0x10808], [0x1080A, 0x10835], [0x10837, 0x10838], [0x1083C, 0x1083C],
  [0x1083F, 0x10855], [0x10857, 0x1089E], [0x108A7, 0x108AF], [0x108E0, 0x108F2], [0x108F4, 0x108F5], [0x108FB, 0x1091B], [0x1091F, 0x10939], [0x1093F, 0x10959],
  [0x10980, 0x109B7], [0x109BC, 0x109CF], [0x109D2, 0x10A03], [0x10A05, 0x10A06], [0x10A0C, 0x10A13], [0x10A15, 0x10A17], [0x10A19, 0x10A35], [0x10A38, 0x10A3A],
  [0x10A3F, 0x10A48], [0x10A50, 0x10A58], [0x10A60, 0x10A9F], [0x10AC0, 0x10AE6], [0x10AEB, 0x10AF6], [0x10B00, 0x10B35], [0x10B39, 0x10B55], [0x10B58, 0x10B72],
  [0x10B78, 0x10B91], [0x10B99, 0x10B9C], [0x10BA9, 0x10BAF], [0x10C00, 0x10C48], [0x10C80, 0x10CB2], [0x10CC0, 0x10CF2], [0x10CFA, 0x10D27], [0x10D30, 0x10D39],
  [0x10D40, 0x10D65], [0x10D69, 0x10D85], [0x10D8E, 0x10D8F], [0x10E60, 0x10E7E], [0x10E80, 0x10EA9], [0x10EAB, 0x10EAD], [0x10EB0, 0x10EB1], [0x10EC2, 0x10EC7],
  [0x10ED0, 0x10ED8], [0x10EFA, 0x10F27], [0x10F30, 0x10F59], [0x10F70, 0x10F89], [0x10FB0, 0x10FCB], [0x10FE0, 0x10FF6], [0x11000, 0x1104D], [0x11052, 0x11075],
  [0x1107F, 0x110C2], [0x110CD, 0x110CD], [0x110D0, 0x110E8], [0x110F0, 0x110F9], [0x11100, 0x11134], [0x11136, 0x11147], [0x11150, 0x11176], [0x11180, 0x111DF],
  [0x111E1, 0x111F4], [0x11200, 0x11211], [0x11213, 0x11241], [0x11280, 0x11286], [0x11288, 0x11288], [0x1128A, 0x1128D], [0x1128F, 0x1129D], [0x1129F, 0x112A9],
  [0x112B0, 0x112EA], [0x112F0, 0x112F9], [0x11300, 0x11303], [0x11305, 0x1130C], [0x1130F, 0x11310], [0x11313, 0x11328], [0x1132A, 0x11330], [0x11332, 0x11333],
  [0x11335, 0x11339], [0x1133B, 0x11344], [0x11347, 0x11348], [0x1134B, 0x1134D], [0x11350, 0x11350], [0x11357, 0x11357], [0x1135D, 0x11363], [0x11366, 0x1136C],
  [0x11370, 0x11374], [0x11380, 0x11389], [0x1138B, 0x1138B], [0x1138E, 0x1138E], [0x11390, 0x113B5], [0x113B7, 0x113C0], [0x113C2, 0x113C2], [0x113C5, 0x113C5],
  [0x113C7, 0x113CA], [0x113CC, 0x113D5], [0x113D7, 0x113D8], [0x113E1, 0x113E2], [0x11400, 0x1145B], [0x1145D, 0x11461], [0x11480, 0x114C7], [0x114D0, 0x114D9],
  [0x11580, 0x115B5], [0x115B8, 0x115DD], [0x11600, 0x11644], [0x11650, 0x11659], [0x11660, 0x1166C], [0x11680, 0x116B9], [0x116C0, 0x116C9], [0x116D0, 0x116E3],
  [0x11700, 0x1171A], [0x1171D, 0x1172B], [0x11730, 0x11746], [0x11800, 0x1183B], [0x118A0, 0x118F2], [0x118FF, 0x11906], [0x11909, 0x11909], [0x1190C, 0x11913],
  [0x11915, 0x11916], [0x11918, 0x11935], [0x11937, 0x11938], [0x1193B, 0x11946], [0x11950, 0x11959], [0x119A0, 0x119A7], [0x119AA, 0x119D7], [0x119DA, 0x119E4],
  [0x11A00, 0x11A47], [0x11A50, 0x11AA2], [0x11AB0, 0x11AF8], [0x11B00, 0x11B09], [0x11B60, 0x11B67], [0x11BC0, 0x11BE1], [0x11BF0, 0x11BF9], [0x11C00, 0x11C08],
  [0x11C0A, 0x11C36], [0x11C38, 0x11C45], [0x11C50, 0x11C6C], [0x11C70, 0x11C8F], [0x11C92, 0x11CA7], [0x11CA9, 0x11CB6], [0x11D00, 0x11D06], [0x11D08, 0x11D09],
  [0x11D0B, 0x11D36], [0x11D3A, 0x11D3A], [0x11D3C, 0x11D3D], [0x11D3F, 0x11D47], [0x11D50, 0x11D59], [0x11D60, 0x11D65], [0x11D67, 0x11D68], [0x11D6A, 0x11D8E],
  [0x11D90, 0x11D91], [0x11D93, 0x11D98], [0x11DA0, 0x11DA9], [0x11DB0, 0x11DDB], [0x11DE0, 0x11DE9], [0x11EE0, 0x11EF8], [0x11F00, 0x11F10], [0x11F12, 0x11F3A],
  [0x11F3E, 0x11F5A], [0x11FB0, 0x11FB0], [0x11FC0, 0x11FF1], [0x11FFF, 0x12399], [0x12400, 0x1246E], [0x12470, 0x12474], [0x12480, 0x12543], [0x12F90, 0x12FF2],
  [0x13000, 0x13455], [0x13460, 0x143FA], [0x14400, 0x14646], [0x16100, 0x16139], [0x16800, 0x16A38], [0x16A40, 0x16A5E], [0x16A60, 0x16A69], [0x16A6E, 0x16ABE],
  [0x16AC0, 0x16AC9], [0x16AD0, 0x16AED], [0x16AF0, 0x16AF5], [0x16B00, 0x16B45], [0x16B50, 0x16B59], [0x16B5B, 0x16B61], [0x16B63, 0x16B77], [0x16B7D, 0x16B8F],
  [0x16D40, 0x16D79], [0x16E40, 0x16E9A], [0x16EA0, 0x16EB8], [0x16EBB, 0x16ED3], [0x16F00, 0x16F4A], [0x16F4F, 0x16F87], [0x16F8F, 0x16F9F], [0x1BC00, 0x1BC6A],
  [0x1BC70, 0x1BC7C], [0x1BC80, 0x1BC88], [0x1BC90, 0x1BC99], [0x1BC9C, 0x1BCA3], [0x1CC00, 0x1CCFC], [0x1CD00, 0x1CEB3], [0x1CEBA, 0x1CED0], [0x1CEE0, 0x1CEF0],
  [0x1CF00, 0x1CF2D], [0x1CF30, 0x1CF46], [0x1CF50, 0x1CFC3], [0x1D000, 0x1D0F5], [0x1D100, 0x1D126], [0x1D129, 0x1D1EA], [0x1D200, 0x1D245], [0x1D2C0, 0x1D2D3],
  [0x1D2E0, 0x1D2F3], [0x1D377, 0x1D378], [0x1D400, 0x1D454], [0x1D456, 0x1D49C], [0x1D49E, 0x1D49F], [0x1D4A2, 0x1D4A2], [0x1D4A5, 0x1D4A6], [0x1D4A9, 0x1D4AC],
  [0x1D4AE, 0x1D4B9], [0x1D4BB, 0x1D4BB], [0x1D4BD, 0x1D4C3], [0x1D4C5, 0x1D505], [0x1D507, 0x1D50A], [0x1D50D, 0x1D514], [0x1D516, 0x1D51C], [0x1D51E, 0x1D539],
  [0x1D53B, 0x1D53E], [0x1D540, 0x1D544], [0x1D546, 0x1D546], [0x1D54A, 0x1D550], [0x1D552, 0x1D6A5], [0x1D6A8, 0x1D7CB], [0x1D7CE, 0x1DA8B], [0x1DA9B, 0x1DA9F],
  [0x1DAA1, 0x1DAAF], [0x1DF00, 0x1DF1E], [0x1DF25, 0x1DF2A], [0x1E000, 0x1E006], [0x1E008, 0x1E018], [0x1E01B, 0x1E021], [0x1E023, 0x1E024], [0x1E026, 0x1E02A],
  [0x1E030, 0x1E06D], [0x1E08F, 0x1E08F], [0x1E100, 0x1E12C], [0x1E130, 0x1E13D], [0x1E140, 0x1E149], [0x1E14E, 0x1E14F], [0x1E290, 0x1E2AE], [0x1E2C0, 0x1E2F9],
  [0x1E2FF, 0x1E2FF], [0x1E4D0, 0x1E4F9], [0x1E5D0, 0x1E5FA], [0x1E5FF, 0x1E5FF], [0x1E6C0, 0x1E6DE], [0x1E6E0, 0x1E6F5], [0x1E6FE, 0x1E6FF], [0x1E7E0, 0x1E7E6],
  [0x1E7E8, 0x1E7EB], [0x1E7ED, 0x1E7EE], [0x1E7F0, 0x1E7FE], [0x1E800, 0x1E8C4], [0x1E8C7, 0x1E8D6], [0x1E900, 0x1E94B], [0x1E950, 0x1E959], [0x1E95E, 0x1E95F],
  [0x1EC71, 0x1ECB4], [0x1ED01, 0x1ED3D], [0x1EE00, 0x1EE03], [0x1EE05, 0x1EE1F], [0x1EE21, 0x1EE22], [0x1EE24, 0x1EE24], [0x1EE27, 0x1EE27], [0x1EE29, 0x1EE32],
  [0x1EE34, 0x1EE37], [0x1EE39, 0x1EE39], [0x1EE3B, 0x1EE3B], [0x1EE42, 0x1EE42], [0x1EE47, 0x1EE47], [0x1EE49, 0x1EE49], [0x1EE4B, 0x1EE4B], [0x1EE4D, 0x1EE4F],
  [0x1EE51, 0x1EE52], [0x1EE54, 0x1EE54], [0x1EE57, 0x1EE57], [0x1EE59, 0x1EE59], [0x1EE5B, 0x1EE5B], [0x1EE5D, 0x1EE5D], [0x1EE5F, 0x1EE5F], [0x1EE61, 0x1EE62],
  [0x1EE64, 0x1EE64], [0x1EE67, 0x1EE6A], [0x1EE6C, 0x1EE72], [0x1EE74, 0x1EE77], [0x1EE79, 0x1EE7C], [0x1EE7E, 0x1EE7E], [0x1EE80, 0x1EE89], [0x1EE8B, 0x1EE9B],
  [0x1EEA1, 0x1EEA3], [0x1EEA5, 0x1EEA9], [0x1EEAB, 0x1EEBB], [0x1EEF0, 0x1EEF1], [0x1F000, 0x1F003], [0x1F005, 0x1F02B], [0x1F030, 0x1F093], [0x1F0A0, 0x1F0AE],
  [0x1F0B1, 0x1F0BF], [0x1F0C1, 0x1F0CE], [0x1F0D1, 0x1F0F5], [0x1F100, 0x1F18D], [0x1F18F, 0x1F190], [0x1F19B, 0x1F1AD], [0x1F1E6, 0x1F1FF], [0x1F321, 0x1F32C],
  [0x1F336, 0x1F336], [0x1F37D, 0x1F37D], [0x1F394, 0x1F39F], [0x1F3CB, 0x1F3CE], [0x1F3D4, 0x1F3DF], [0x1F3F1, 0x1F3F3], [0x1F3F5, 0x1F3F7], [0x1F43F, 0x1F43F],
  [0x1F441, 0x1F441], [0x1F4FD, 0x1F4FE], [0x1F53E, 0x1F54A], [0x1F54F, 0x1F54F], [0x1F568, 0x1F579], [0x1F57B, 0x1F594], [0x1F597, 0x1F5A3], [0x1F5A5, 0x1F5FA],
  [0x1F650, 0x1F67F], [0x1F6C6, 0x1F6CB], [0x1F6CD, 0x1F6CF], [0x1F6D3, 0x1F6D4], [0x1F6E0, 0x1F6EA], [0x1F6F0, 0x1F6F3], [0x1F700, 0x1F7D9], [0x1F800, 0x1F80B],
  [0x1F810, 0x1F847], [0x1F850, 0x1F859], [0x1F860, 0x1F887], [0x1F890, 0x1F8AD], [0x1F8B0, 0x1F8BB], [0x1F8C0, 0x1F8C1], [0x1F8D0, 0x1F8D8], [0x1F900, 0x1F90B],
  [0x1F93B, 0x1F93B], [0x1F946, 0x1F946], [0x1FA00, 0x1FA57], [0x1FA60, 0x1FA6D], [0x1FB00, 0x1FB92], [0x1FB94, 0x1FBFA], [0xE0001, 0xE0001], [0xE0020, 0xE007F],
  [0xE0100, 0xE01EF], [0xF0000, 0xFFFFD], [0x100000, 0x10FFFD],
]);
/** THE ONE STATED ADDITION to the generated table (the coordinator's ruling on wave 195: no code point counts narrower
 *  than it did on main): U+3248 to U+324F, circled numbers on black squares. The data file gives them A (ambiguous
 *  width), so the table lists them as one cell; the hand list on main counted them two cells (its range U+3041 to U+33FF
 *  took them in). They stay two cells, because a terminal that draws an ambiguous character wide draws them in two, and
 *  over-counting only refuses. A case holds that, over every code point, nothing counts narrower than on main. */
export const FRAMES_WIDE_KEPT: readonly (readonly [number, number])[] = Object.freeze([[0x3248, 0x324F]]);
/** The engine's one class beside the table, a WIDENER only: an emoji drawn as one (`Emoji_Presentation`, which takes in
 *  the regional indicators the data file gives N). It can make a code point two cells that the table makes one, never
 *  the other way, so a newer engine only widens; a case holds that every code point counts at least what the table and
 *  the stated addition give it. A PRIVATE-USE code point (`Co`) never reaches the width: rule 1 refuses the frame whole
 *  (`not-a-frame`) first, as it does a surrogate, a control and a format character; were it asked, it would count one
 *  cell (the data file gives it A). */
const WIDE_CLASS = /\p{Emoji_Presentation}/u;
/** How many screen cells one character (one code point) takes: two when it is the stated addition, an emoji drawn as
 *  one, or not in the one-cell table (wide, fullwidth, or not listed in the 17.0 file); one otherwise. A row read with these widths
 *  is never narrower than a terminal that follows the 17.0 data draws it, with one exception: a terminal in an East Asian
 *  locale draws an ambiguous-width character (A) in two cells, and the table counts the A characters one cell, as main
 *  did, less the eight of the stated addition. The frames driver runs under `LANG=C.UTF-8` (read in
 *  `agent/src/testbox/captureFramesRun.ts`), which is not one; how the terminal draws them there is inferred, not
 *  measured. A combining or zero-width mark counts one though it is drawn in none, so a base character followed by the
 *  emoji selector (U+FE0F) or the keycap mark (U+20E3) counts at least two in a row: wider, never narrower. */
export function frameCellWidth(c: string): 1 | 2 {
  const cp = c.codePointAt(0) ?? 0;
  if (FRAMES_WIDE_KEPT.some(([a, b]) => cp >= a && cp <= b)) return 2;
  if (WIDE_CLASS.test(c)) return 2;
  let lo = 0;
  let hi = FRAMES_ONE_CELL_RANGES.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = FRAMES_ONE_CELL_RANGES[mid]!;
    if (cp < a) hi = mid - 1;
    else if (cp > b) lo = mid + 1;
    else return 1;
  }
  return 2;
}
/** A row's width in screen cells. */
const cellsOf = (cps: readonly string[]): number => cps.reduce((n, c) => n + frameCellWidth(c), 0);

/** The emoji selector and the keycap mark: a base character before either is drawn as an emoji, two cells wide. */
const EMOJI_SELECTOR = String.fromCodePoint(0xfe0f);
const KEYCAP_MARK = String.fromCodePoint(0x20e3);
/** A code point that cannot begin a character by itself: a combining mark, the engine's mark class (`\p{M}`). The
 *  engine's second class beside the table, and a WIDENER only, under F2's same exception and for the same reason as the
 *  emoji class (the coordinator's ruling on review 4161's F1): it only ever makes the first character of a next row count
 *  two cells, which only refuses. Two hosts whose engines disagree on a mark therefore lose a frame (one of them refuses
 *  it) and never keep a tail. The emoji selector and the keycap mark are named beside it, so those two hold with no
 *  engine asked. A LIMIT (review 4168): the class is only as new as the engine. Two hosts whose engines are BOTH older
 *  than the table's Unicode version count a mark newer than their engine one cell, so a next row that begins with such a
 *  mark keeps its tail on both (42 marks on a 16.0 engine, none on 17.0 or newer, by the reviewer's emulation). The cure,
 *  a generated mark table beside the width table, is the alarm wave's, by the coordinator's ruling. */
const LEADING_MARK = /^\p{M}/u;
/** How many cells the FIRST character of `content` takes, with what follows it (review 4133's F1, review 4161's F1): two
 *  when content begins with a code point that cannot begin a character by itself (the emoji selector, the keycap mark, or
 *  any combining mark: what is left when the leading decoration was a base the mark belonged to, as in the turn marker
 *  followed by the selector); two when its code point is two cells; two when the emoji selector or the keycap mark follows
 *  it, since a terminal may draw such a base in two cells though the base alone counts one; zero for an empty content.
 *  A mark before a narrow character also counts two, so such a next row refuses a row one cell short of the edge: an
 *  accepted over-refusal. */
function firstCells(content: string): number {
  const cps = Array.from(content);
  if (cps[0] === undefined) return 0;
  if (cps[0] === EMOJI_SELECTOR || cps[0] === KEYCAP_MARK) return 2;
  if (LEADING_MARK.test(cps[0])) return 2;
  if (cps[1] === EMOJI_SELECTOR || cps[1] === KEYCAP_MARK) return 2;
  return frameCellWidth(cps[0]);
}

/** THE ONE READER OF THE NEXT ROW (the coordinator's ruling on review 4133's F1): its content after the leading
 *  decoration (`spans`), which both the straddle test and the tail are read from, so the two cannot disagree. */
const nextRowContent = (next: string): string => spans(next).content;

/** Whether a row's text runs to its last column (review 4086's F-B, review 4109's R1): measured in screen cells AFTER its
 *  trailing spaces are dropped, its last character is neither the decoration nor a rule's `─`, and it either fills the
 *  pane's width, or it ends ONE CELL SHORT and the next row's content (after its leading decoration, the one reader)
 *  begins with a two-cell character. That is a STRADDLE: a wide character that does not fit in the last cell is wrapped
 *  whole to the next row, and the last cell is left blank, which a read of the pane may give as a trailing space or as
 *  nothing (ruling 3). Measured on the row as drawn, a row that keeps that blank cell as a space would read as full but
 *  ending in a space, and the rule would keep the path it continues: the wrong direction. */
export function runsToTheEdge(row: string, next: string, pane: FramesPane): boolean {
  const cps = Array.from(row.replace(/\s+$/u, ''));
  const last = cps[cps.length - 1];
  if (last === undefined || DECOR.has(last) || last === '─') return false;
  const cells = cellsOf(cps);
  return cells >= pane.cols || (cells === pane.cols - 1 && firstCells(nextRowContent(next)) === 2);
}

/** THE FULL-WIDTH RULE, on both hosts (review 4069's F2): a token holding a `/` that runs to a full-width row's last
 *  column, or to the cell before a straddling wide character, and goes on at the start of the next row, which is not ours
 *  and not a rule row. The pane wrapped a path: refused whole. */
function pathOffTheEdge(a: string, b: string, pane: FramesPane): boolean {
  if (!runsToTheEdge(a, b, pane)) return false;
  // The head is read where the edge was measured: after the trailing spaces a straddle's blank cell may leave.
  const head = /\S+$/u.exec(a.replace(/\s+$/u, ''))?.[0] ?? '';
  const tail = /^\s*(\S+)/u.exec(nextRowContent(b))?.[1] ?? ''; // whitespace skipped first, as in `pathTail` (review 4168, F1)
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
 *  masker would change a text: its shapes on the box (the default), the live masker on the server.
 *
 *  WHAT IT RETURNS AS REDUCED PASSES THE SERVER'S CHECK, BY CONSTRUCTION (the coordinator's ruling on review 4133's F3):
 *  it runs that check on its own result, with its own `ours`, `scan` and `mask`, and refuses the frame with the check's
 *  word when the check would refuse it. The masks are not the same on the two hosts: the box reduces with the default
 *  (the masker's shapes) and the server checks with its live masker, so the server may still refuse (`masked`) a frame
 *  the box reduced. That loses a frame and leaks nothing (review 4161, A5). A replaced row is padded in screen cells, so a row of characters that count two
 *  cells but take one code point can come out longer in code points than the shape gate allows: the box refuses it
 *  (`not-a-frame`) rather than send what the server would drop. */
export function reduceFrame(
  frame: string, pane: FramesPane, ours: readonly string[], privates: readonly string[], scan: FramesScan, mask: (t: string) => boolean = credentialShaped,
): ReduceAnswer {
  const r = reduceOnce(frame, pane, ours, privates, scan, mask);
  if (r.kind === 'refused') return r;
  const c = checkOnce(r.text, pane, ours, scan, mask);
  return c.ok ? r : { kind: 'refused', refusal: c.refusal };
}

/** Rules 1 to 9, once: `reduceFrame` less its check of its own result. */
function reduceOnce(
  frame: string, pane: FramesPane, ours: readonly string[], privates: readonly string[], scan: FramesScan, mask: (t: string) => boolean,
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
  return checkOnce(text, pane, ours, scan, mask);
}
/** The check itself, which `reduceFrame` also runs on its own result: rules 1 to 9 once, with no box-side list. */
function checkOnce(
  text: string, pane: FramesPane, ours: readonly string[], scan: FramesScan, mask: (t: string) => boolean,
): { readonly ok: true } | { readonly ok: false; readonly refusal: FramesRefusal } {
  const r = reduceOnce(text, pane, ours, [], scan, mask);
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
    // The coordinator's ruling on wave 195: a row reaching the edge through the stated addition (U+3248, kept two cells).
    'x'.repeat(35) + ' /p' + String.fromCodePoint(0x3248) + '\nq rest',
    // Review 4133's D1: a table-only wide character (U+2329, W in the data file, not an emoji) reaching the edge, and a
    // straddle whose row keeps its blank last cell as a trailing space. No probe asks the engine for anything.
    'x'.repeat(35) + ' /a' + String.fromCodePoint(0x2329) + '\nb rest', 'x'.repeat(35) + ' /pr \n' + String.fromCodePoint(0x6F22) + 'ject rest',
    // Review 4161's F1: a straddle whose next row is the turn marker then the emoji selector, so the selector is left first
    // once the decoration is stripped. It asks the engine for nothing either.
    'x'.repeat(35) + ' /pr\n' + String.fromCodePoint(0x23FA) + String.fromCodePoint(0xFE0F) + 'ject rest',
    // Review 4168's F1: a full row, then a next row that begins with the ideographic space, then the path's tail.
    'x'.repeat(36) + ' /pr\n' + String.fromCodePoint(0x3000) + 'ject rest',
  ];
  // Each probe drawn as a box draws it: between two rules, the capture's status row under the lower one (rule 8). And the
  // status rule's own probes: no rule, another status text, the text twice.
  const rule = '─'.repeat(12);
  const boxed = (p: string): string => `${rule}\n${p}\n${rule}\n  ${FRAMES_STATUS_TEXT}\n`;
  const status = ['plain row\n', `${rule}\n  other status\n`, `${rule}\n  ${FRAMES_STATUS_TEXT}\n  ${FRAMES_STATUS_TEXT}\n`];
  return JSON.stringify([...probes.map(boxed), ...status].map((f) => reduceFrame(f, pane, ['ours text here'], ['/secret/x', 'bo'], none)));
}
