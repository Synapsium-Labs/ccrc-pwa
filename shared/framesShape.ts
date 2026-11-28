// The box frames recipe's SHAPE rule (Desktop polish wave 198; plan docs/superpowers/plans/2026-11-28-box-frames-alarm.md
// section 2, after section 7 of docs/superpowers/plans/2026-11-26-box-frames-recipe.md, agreed in substance by the capture
// owner). L0, pure: imports only `shared/` siblings, and no `node:*` module.
//
// From a frame's REDUCED text (what the store keeps, cleared by the receiver's check) to a token list and its hash. A token
// keeps a row's CLASS and the structure the send reads, and never the build's own words outside a rule label and a chip:
// two builds that draw the box in the same form give the same tokens for the same part, whatever their banners and hints
// say. The tokens and the hash are the server's own: nothing here is ever served (the status read carries words, build
// names and frame ids only, `framesStanding.ts`).
import { fnv1a } from './framesCapture.js';
import { FRAMES_DECORATION, isRuleRow, oursSquashed, rowIsOurs, spans } from './framesReduce.js';
import { stripFrameSgr } from './framesResult.js';

/** The prompt glyph, and its older form, as a row of the box starts with it. */
export const FRAME_GLYPHS: readonly string[] = Object.freeze(['❯', '>']);

/** The border characters a blank row may hold, and the corners a rule label drops. */
export const FRAME_BORDERS: readonly string[] = Object.freeze(['│', '╭', '╮', '╰', '╯']);

/** Claude Code's own paste label, as the send reads it (`server/src/inject/send.ts`'s `PASTE_CHIP`, which an L0 file
 *  cannot import: a copy across the ring boundary, held equal to the send's by a text case in `frames-shape.test.ts`). */
export const FRAME_CHIP_LABEL = '[Pasted text #';

const DECOR = new Set(FRAMES_DECORATION);
const BORDER = new Set(FRAME_BORDERS);

// ── the skeletons ───────────────────────────────────────────────────────────────────────────────────────────────

/** Whitespace runs as one space, trimmed, and every run of digits as `9`. */
const skeleton = (s: string): string => s.replace(/\s+/gu, ' ').trim().replace(/\p{Nd}+/gu, '9');

/** A rule row's label skeleton: every `─` and every corner removed, then {@link skeleton}. `↑ 156 more` is `↑ 9 more`. */
const ruleLabel = (plain: string): string => skeleton(Array.from(plain).filter((c) => c !== '─' && !BORDER.has(c)).join(''));

const CHIP = /\[Pasted text #\p{Nd}/u;
/** A chip's skeleton: from the paste label to the next `]` (or the row's end), then {@link skeleton}. */
function chipLabel(plain: string): string {
  const at = plain.indexOf(FRAME_CHIP_LABEL);
  const end = plain.indexOf(']', at);
  return skeleton(plain.slice(at, end < 0 ? undefined : end + 1));
}

/** Whether a row, its leading spaces and `│` dropped, starts with the prompt glyph. */
const startsWithGlyph = (plain: string): boolean => FRAME_GLYPHS.some((g) => plain.replace(/^[\s│]+/u, '').startsWith(g));

// ── dim ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The dim state after one SGR sequence's parameters: `2` on; `22`, `0` and an empty sequence off; the extended colour
 *  forms (`38`, `48`, `58`) take their arguments with them, so a colour index of 2 is never read as dim. */
export function dimAfter(dim: boolean, params: string): boolean {
  if (params === '') return false;
  const ps = params.split(';');
  for (let k = 0; k < ps.length; k++) {
    const p = ps[k]!;
    const head = p.split(':')[0]!;
    if (head === '38' || head === '48' || head === '58') {
      if (p.includes(':')) continue; // the colon form carries its arguments inside its own parameter
      if (ps[k + 1] === '5') k += 2;
      else if (ps[k + 1] === '2') k += 4;
      continue;
    }
    const n = head === '' ? 0 : Number(head);
    if (n === 0 || n === 22) dim = false;
    else if (n === 2) dim = true;
  }
  return dim;
}

const SGR_AT = /\x1b\[([0-9;:]*)m/y;
/** Whether one or more of a row's characters that are neither whitespace nor decoration is drawn while dim is on. */
export function rowIsDim(row: string): boolean {
  let dim = false;
  let i = 0;
  while (i < row.length) {
    if (row.charCodeAt(i) === 0x1b) {
      SGR_AT.lastIndex = i;
      const m = SGR_AT.exec(row);
      if (m !== null) { dim = dimAfter(dim, m[1]!); i = SGR_AT.lastIndex; continue; }
    }
    const ch = String.fromCodePoint(row.codePointAt(i)!);
    if (dim && !/\s/u.test(ch) && !DECOR.has(ch)) return true;
    i += ch.length;
  }
  return false;
}

// ── the classes ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A row's class (plan 2.1): rule, chip, glyph, our text, blank, other. The first that matches wins. */
export type FrameRowClass = 'R' | 'C' | 'G' | 'T' | 'B' | 'X';

/** One row's class and token. */
function rowToken(row: string, oursSq: readonly string[]): { readonly cls: FrameRowClass; readonly token: string } {
  const plain = stripFrameSgr(row);
  const dim = (): string => (rowIsDim(row) ? '~' : '');
  if (isRuleRow(plain)) return { cls: 'R', token: `R:${ruleLabel(plain)}` };
  if (CHIP.test(plain)) return { cls: 'C', token: `C${startsWithGlyph(plain) ? 'g' : ''}${dim()}:${chipLabel(plain)}` };
  if (startsWithGlyph(plain)) return { cls: 'G', token: `G${dim()}` };
  if (rowIsOurs(plain, oursSq)) return { cls: 'T', token: `T${dim()}` };
  const rest = Array.from(plain).filter((c) => !/\s/u.test(c) && !BORDER.has(c));
  if (rest.length === 0) return { cls: 'B', token: Array.from(plain).some((c) => BORDER.has(c)) ? 'B|' : 'B' };
  const { lead, tail } = spans(plain);
  const indent = /^ */.exec(plain)![0].length;
  return { cls: 'X', token: `X${indent}|${(lead + tail).replace(/\s/gu, '')}` };
}

// ── the shape ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A frame's shape: its tokens and their hash. */
export interface FrameShape { readonly tokens: readonly string[]; readonly hash: string }

/** 16 lowercase hex over `text`: the recipes' FNV-1a (`framesCapture.ts#fnv1a`, the frames files' one copy) at their
 *  two seeds. */
const hex16 = (text: string): string => [0x811c9dc5, 0x9e3779b9].map((s) => fnv1a(text, s).toString(16).padStart(8, '0')).join('');

/** The 16 hex shape a hash and a shape version have. */
export const FRAME_SHAPE_HEX = /^[0-9a-f]{16}$/;

/** THE SHAPE RULE (plan section 2). `text`: a reduced frame. `cursor`: its `[column, row]`, or null. `ours`: the part's own
 *  fixed texts (`framesCapture.ts#framesOurs`). One token per row; above the box's top rule (the rule row above the lowest
 *  one, or the only one) each run of other rows is one `X+` and each run of blank rows one `B+`; then one cursor token,
 *  `@<row less the top rule's row>,<column>`, or `@-`. */
export function frameShape(text: string, cursor: readonly [number, number] | null, ours: readonly string[]): FrameShape {
  const rows = text.split('\n');
  if (rows.length > 1 && rows[rows.length - 1] === '') rows.pop();
  const oursSq = oursSquashed(ours);
  const read = rows.map((r) => rowToken(r, oursSq));
  const rules = read.flatMap((r, i) => (r.cls === 'R' ? [i] : []));
  const top = rules.length >= 2 ? rules[rules.length - 2]! : (rules[0] ?? 0);
  const tokens: string[] = [];
  read.forEach((r, i) => {
    if (i < top && (r.cls === 'X' || r.cls === 'B')) {
      if (i > 0 && read[i - 1]!.cls === r.cls) return;
      tokens.push(`${r.cls}+`);
      return;
    }
    tokens.push(r.token);
  });
  tokens.push(cursor === null ? '@-' : `@${cursor[1] - top},${cursor[0]}`);
  return { tokens, hash: hex16(JSON.stringify(tokens)) };
}

/** The shape version a shape function gives: the hash of its answers on a fixed probe table (plan 2.5), so a change in
 *  what the rule does changes the version and a change in how it is spelled does not. */
export function frameShapeVersionOf(shape: typeof frameShape): string {
  const rule = '─'.repeat(12);
  const status = '  ccrc capture';
  const ours = ['frames row 001 of 003 abc', 'frames row 002 of 003 abc', 'earlier turn ZQX'];
  const boxed = (...rows: string[]): string => [...rows, rule, status].join('\n');
  const probes: readonly (readonly [string, readonly [number, number] | null])[] = [
    // Plan 2.6's three examples, shortened.
    [['╭' + rule + '╮', '│ ✻ Welcome to the box │', '│              │', '│ ‹working directory› │', '╰' + rule + '╯', '', rule,
      '❯ frames row 001 of 003 abc', '  frames row 002 of 003 abc', rule, status].join('\n'), [30, 9]],
    [['banner one', 'banner two', '', rule.slice(0, 4) + ' ↑ 156 more ' + rule, '  frames row 002 of 003 abc', rule, status].join('\n'), [30, 4]],
    [boxed(rule, '❯ \x1b[2mTry "write a test"\x1b[0m'), [2, 1]],
    [boxed(rule, '❯ [Pasted text #1 +0 lines]'), null],
    // Every class, and the precedence: a chip on no glyph, a glyph row of our text, our text, a bordered blank, an X row.
    [boxed('earlier turn ZQX', '  ⎿  some words here', rule, '[Pasted text #12 +3 lines]', '❯ frames row 001 of 003 abc',
      '  frames row 002 of 003 abc', '│          │', '  hint words'), [0, 0]],
    // Dim: on, combined, a colour index of 2, the colon form, a reset, dim on decoration only.
    [boxed(rule, '\x1b[1;2m  frames row 001 of 003 abc\x1b[0m', '\x1b[38;5;2m  frames row 002 of 003 abc\x1b[m',
      '\x1b[38:5:2m  earlier turn ZQX', '\x1b[2m❯\x1b[22m frames row 001 of 003 abc'), null],
    // A cursor above the box's top rule.
    [boxed('x', rule, '❯ frames row 001 of 003 abc'), [5, 0]],
    // The anchor (the coordinator's ruling 1 on step 1): one rule row, and three (a separator inside the box).
    [['zz', 'qq', '❯ frames row 001 of 003 abc', rule, status].join('\n'), null],
    [['zz', rule, 'hint words', '❯ frames row 001 of 003 abc', rule, 'more words', rule, status].join('\n'), [1, 3]],
  ];
  return hex16(JSON.stringify(probes.map(([t, c]) => shape(t, c, ours))));
}

/** THE shape version: this rule's answers on its probe table. */
export const FRAME_SHAPE_VERSION: string = frameShapeVersionOf(frameShape);
