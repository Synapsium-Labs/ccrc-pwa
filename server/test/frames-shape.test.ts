// The box frames recipe's SHAPE rule (Desktop polish wave 198; plan docs/superpowers/plans/2026-11-28-box-frames-alarm.md
// section 2). Pure: every case feeds a reduced frame, as the store keeps it, and reads the tokens. No Claude Code, no tmux.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { framesOurs } from '../../shared/framesCapture.js';
import { isRuleRow, oursSquashed, rowIsOurs } from '../../shared/framesReduce.js';
import { FRAMES_PARTS } from '../../shared/framesResult.js';
import {
  FRAME_CHIP_LABEL, FRAME_SHAPE_HEX, FRAME_SHAPE_VERSION, dimAfter, frameShape, frameShapeVersionOf, rowIsDim,
} from '../../shared/framesShape.js';

const RULE = '─'.repeat(40);
const STATUS = '  ccrc capture';
const OURS = ['frames row 001 of 003 abcdefghij', 'frames row 002 of 003 abcdefghij', 'frames row 003 of 003 abcdefghij', 'frames earlier turn ZQX-END-turn'];
/** A box: its top rule, the rows given, its lower rule and the capture's status row under it. */
const box = (...rows: string[]): string[] => [RULE, ...rows, RULE, STATUS];
const shapeOf = (rows: readonly string[], cursor: readonly [number, number] | null = null): readonly string[] => frameShape(rows.join('\n'), cursor, OURS).tokens;
/** The tokens of the box's rows only: from the top rule to the status row, less the cursor token. */
const inBox = (rows: readonly string[]): readonly string[] => shapeOf(rows).slice(0, -1);

describe('each class has its own token (plan 2.1)', () => {
  it('a rule row is R with its label skeleton: corners and rule characters gone, digit runs as 9', () => {
    expect(inBox(box('❯ frames row 001 of 003 abcdefghij'))[0]).toBe('R:');
    expect(shapeOf(['──── ↑ 156 more ' + RULE, '  frames row 002 of 003 abcdefghij', RULE, STATUS])[0]).toBe('R:↑ 9 more');
    expect(shapeOf(['╭' + RULE + '╮', '│ x │', '╰' + RULE + '╯', RULE, '❯', RULE, STATUS])[0]).toBe('R:');
    expect(shapeOf(['─── 12   of 345 ' + RULE, '❯', RULE, STATUS])[0]).toBe('R:9 of 9');
  });

  it('a chip row is C with its skeleton, g when it is on the glyph row', () => {
    expect(inBox(box('❯ [Pasted text #1 +179 lines]'))[1]).toBe('Cg:[Pasted text #9 +9 lines]');
    expect(inBox(box('  [Pasted text #12 +3 lines] and more'))[1]).toBe('C:[Pasted text #9 +9 lines]');
    expect(inBox(box('  [Pasted text #2'))[1]).toBe('C:[Pasted text #9');
  });

  it('a glyph row is G, the older glyph too, after leading spaces and a border', () => {
    expect(inBox(box('❯ frames row 001 of 003 abcdefghij'))[1]).toBe('G');
    expect(inBox(box('> frames row 001 of 003 abcdefghij'))[1]).toBe('G');
    expect(inBox(box('│ ❯ '))[1]).toBe('G');
  });

  it('a row of our own text is T, by the reducer\'s own rule 2 test (a run of one of ours)', () => {
    expect(inBox(box('  frames row 002 of 003 abcdefghij'))[1]).toBe('T');
    expect(inBox(box('⏺ frames earlier turn ZQX-END-turn'))[1]).toBe('T');
    expect(inBox(box('  frames row 002 of 003'))[1]).toBe('T'); // a wrapped fragment is a run of ours
  });

  it('a blank row is B, and B| when it holds a border character', () => {
    expect(inBox(box('   '))[1]).toBe('B');
    expect(inBox(box(''))[1]).toBe('B');
    expect(inBox(box('│          │'))[1]).toBe('B|');
  });

  it('any other row is X with its indent and edge characters, and none of its words', () => {
    expect(inBox(box('  ⎿  Interrupted by user'))[1]).toBe('X2|⎿');
    expect(inBox(box('│ some text here │'))[1]).toBe('X0|││');
    expect(inBox(box('hint words'))[1]).toBe('X0|');
    expect(shapeOf(box('x')).at(-2)).toBe('X2|'); // the capture's status row
    expect(inBox(box('  one set of words'))).toEqual(inBox(box('  another set of words, longer')));
  });
});

describe('the classes\' precedence: rule, chip, glyph, our text, blank, other (plan 2.1)', () => {
  it('a glyph row of our text is G, not T: the old form\'s first draft row and the new form\'s differ', () => {
    expect(inBox(box('❯ frames row 001 of 003 abcdefghij'))[1]).toBe('G');
    expect(inBox(box('  frames row 001 of 003 abcdefghij'))[1]).toBe('T');
  });
  it('a chip on the glyph row is C, not G', () => {
    expect(inBox(box('❯ [Pasted text #1]'))[1]).toBe('Cg:[Pasted text #9]');
  });
  it('a rule row holding our text is R', () => {
    expect(shapeOf([RULE + ' frames row 001 of 003 abcdefghij', '❯', RULE, STATUS])[0]).toBe('R:frames row 9 of 9 abcdefghij');
  });
});

describe('the collapse above the box\'s top rule, and its anchor (plan 2.2)', () => {
  const banner = (n: number): string[] => Array.from({ length: n }, (_, i) => `  banner line ${i} with words`);
  it('a longer banner or scrollback above the box is the same shape', () => {
    const a = shapeOf([...banner(3), '', ...box('❯ frames row 001 of 003 abcdefghij')]);
    const b = shapeOf([...banner(9), '', '', ...box('❯ frames row 001 of 003 abcdefghij')]);
    expect(a).toEqual(b);
    expect(a.slice(0, 2)).toEqual(['X+', 'B+']);
  });
  it('a run of X rows collapses whatever their indents and edges; X and B runs stay apart', () => {
    expect(shapeOf(['zz', '  ⎿ qq', '│ vv │', '', 'yy', ...box('❯')]).slice(0, 3)).toEqual(['X+', 'B+', 'X+']);
  });
  it('an earlier turn\'s rows of our text above the box keep one token each', () => {
    expect(shapeOf(['x', '⏺ frames earlier turn ZQX-END-turn', 'y', ...box('❯')]).slice(0, 3)).toEqual(['X+', 'T', 'X+']);
  });
  it('the anchor is the rule above the lowest rule, so the new form with no glyph row under its top rule still collapses', () => {
    const newForm = [...banner(4), '──── ↑ 156 more ' + RULE, '  frames row 002 of 003 abcdefghij', '  frames row 003 of 003 abcdefghij', RULE, STATUS];
    expect(shapeOf(newForm)).toEqual(['X+', 'R:↑ 9 more', 'T', 'T', 'R:', 'X2|', '@-']);
  });
  it('from the top rule down nothing collapses: two X rows in the box are two tokens', () => {
    expect(inBox(box('hint one', 'hint two'))).toEqual(['R:', 'X0|', 'X0|', 'R:', 'X2|']);
  });
  it('a frame with one rule row anchors on it', () => {
    expect(shapeOf(['zz', 'qq', RULE, STATUS])).toEqual(['X+', 'R:', 'X2|', '@-']);
  });
  // The coordinator's ruling 1 on step 1: a probe and a case each for ONE rule row and for THREE (a separator inside the
  // box), showing what collapses and that each differs from the two-rule form.
  it('one rule row, two and three: what collapses, and the three forms differ', () => {
    const one = ['zz', 'qq', '❯ frames row 001 of 003 abcdefghij', RULE, STATUS];
    const two = ['zz', 'qq', RULE, '❯ frames row 001 of 003 abcdefghij', RULE, STATUS];
    const three = ['zz', 'qq', RULE, '❯ frames row 001 of 003 abcdefghij', RULE, 'hint words', RULE, STATUS];
    expect(shapeOf(one)).toEqual(['X+', 'G', 'R:', 'X2|', '@-']);
    expect(shapeOf(two)).toEqual(['X+', 'R:', 'G', 'R:', 'X2|', '@-']);
    // The top rule is the separator (the rule above the lowest one), so the X rows above the box's first rule collapse,
    // the glyph row between the first rule and the separator keeps its token, and the hint row under the separator too.
    expect(shapeOf(three)).toEqual(['X+', 'R:', 'G', 'R:', 'X0|', 'R:', 'X2|', '@-']);
    const hashes = [one, two, three].map((r) => frameShape(r.join('\n'), null, OURS).hash);
    expect(new Set(hashes).size).toBe(3);
  });
  it('what a wrong anchor costs: X and B runs between two rules lose their counts, rows of our text never do', () => {
    // Three rules: the anchor is the separator, so rows between the first rule and it are "above the box".
    const three = (rows: string[]): string[] => [RULE, ...rows, RULE, '❯', RULE, STATUS];
    expect(shapeOf(three(['hint words']))).toEqual(shapeOf(three(['hint words', 'more words'])));
    expect(shapeOf(three(['', '']))).toEqual(shapeOf(three([''])));
    const t = '  frames row 002 of 003 abcdefghij';
    expect(shapeOf(three([t]))).not.toEqual(shapeOf(three([t, t])));
    expect(shapeOf(three(['❯ frames row 001 of 003 abcdefghij']))).not.toEqual(shapeOf(three(['❯', '❯'])));
  });
});

describe('dim (plan 2.3)', () => {
  it('a row with a content character drawn dim is marked ~', () => {
    expect(inBox(box('❯ \x1b[2mTry "write a test"\x1b[0m'))[1]).toBe('G~');
    expect(inBox(box('\x1b[2m  frames row 002 of 003 abcdefghij\x1b[0m'))[1]).toBe('T~');
    expect(inBox(box('\x1b[2m❯ [Pasted text #1]\x1b[0m'))[1]).toBe('Cg~:[Pasted text #9]');
  });
  it('dim on decoration only is not dim', () => {
    expect(rowIsDim('\x1b[2m❯ \x1b[22mframes row 001')).toBe(false);
  });
  it('a colour index of 2 is not dim, in the semicolon and the colon forms, and a truecolour 2 neither', () => {
    expect(rowIsDim('\x1b[38;5;2mtext')).toBe(false);
    expect(rowIsDim('\x1b[48;5;2mtext')).toBe(false);
    expect(rowIsDim('\x1b[58;5;2mtext')).toBe(false);
    expect(rowIsDim('\x1b[38:5:2mtext')).toBe(false);
    expect(rowIsDim('\x1b[38;2;2;2;2mtext')).toBe(false);
    expect(rowIsDim('\x1b[38;5;2;2mtext')).toBe(true); // the colour, then dim
    expect(rowIsDim('\x1b[38:5:2;2mtext')).toBe(true); // the colon form carries its own arguments: the 2 after it is dim
  });
  it('dim combined with another attribute is dim; 22, 0 and an empty sequence turn it off', () => {
    expect(rowIsDim('\x1b[1;2mtext')).toBe(true);
    expect(dimAfter(true, '22')).toBe(false);
    expect(dimAfter(true, '0')).toBe(false);
    expect(dimAfter(true, '')).toBe(false);
    expect(dimAfter(true, '1')).toBe(true);
    expect(rowIsDim('\x1b[2m\x1b[mtext')).toBe(false);
  });
  it('an X row\'s dim is not kept: words and colour of other rows are not structure', () => {
    expect(inBox(box('\x1b[2mhint words\x1b[0m'))[1]).toBe('X0|');
  });
});

describe('the cursor (plan 2.4)', () => {
  it('its row is counted from the box\'s top rule, its column kept; none is @-', () => {
    const rows = ['banner', '', ...box('❯ frames row 001 of 003 abcdefghij')];
    expect(shapeOf(rows, [34, 3]).at(-1)).toBe('@1,34');
    expect(shapeOf(rows, [0, 0]).at(-1)).toBe('@-2,0');
    expect(shapeOf(rows, null).at(-1)).toBe('@-');
  });
});

describe('the three worked examples (plan 2.6)', () => {
  it('example 1, the old form\'s rows-3', () => {
    const rows = [
      '╭' + RULE + '╮', '│ ✻ Welcome to Claude Code!    │', '│                              │', '│   ‹working directory›        │',
      '╰' + RULE + '╯', '', RULE, '❯ frames row 001 of 003 abcdefghij', '  frames row 002 of 003 abcdefghij',
      '  frames row 003 of 003 abcdefghij', RULE, STATUS,
    ];
    expect(shapeOf(rows, [62, 9])).toEqual(['R:', 'X+', 'B+', 'X+', 'R:', 'B+', 'R:', 'G', 'T', 'T', 'R:', 'X2|', '@3,62']);
  });

  it('example 2, the new form\'s tall draft: a counted top rule and no glyph row, against the old form', () => {
    const ours = framesOurs('rows-180', { cols: 220, rows: 50 });
    const draft = (from: number, n: number): string[] => ours.slice(from, from + n).map((r) => `  ${r}`);
    const newForm = ['banner', '', '──── ↑ 156 more ' + RULE, ...draft(156, 24), RULE, STATUS];
    const oldForm = ['banner', '', RULE, `❯ ${ours[0]}`, ...draft(1, 19), RULE, STATUS];
    const n = frameShape(newForm.join('\n'), [62, 26], ours);
    const o = frameShape(oldForm.join('\n'), [62, 22], ours);
    expect(n.tokens).toEqual(['X+', 'B+', 'R:↑ 9 more', ...Array<string>(24).fill('T'), 'R:', 'X2|', '@24,62']);
    expect(o.tokens.slice(2, 4)).toEqual(['R:', 'G']);
    expect(n.hash).not.toBe(o.hash);
  });

  it('example 3, a ghost hint whose words change is the same shape, and a renamed chip label is not', () => {
    const hint = (words: string): string[] => box(`❯ \x1b[2m${words}\x1b[0m`);
    expect(shapeOf(hint('Try "write a test"'), [2, 1])).toEqual(['R:', 'G~', 'R:', 'X2|', '@1,2']);
    expect(frameShape(hint('Try "write a test"').join('\n'), [2, 1], OURS).hash).toBe(frameShape(hint('Try "fix the build"').join('\n'), [2, 1], OURS).hash);
    expect(inBox(box('❯ [Pasted text #1 +0 lines]'))[1]).toBe('Cg:[Pasted text #9 +9 lines]');
    expect(inBox(box('❯ [Pasted content #1]'))[1]).toBe('G');
  });
});

describe('the hash and the shape version (plan 2.5)', () => {
  it('the hash is 16 hex, equal for equal tokens and different for different ones', () => {
    const a = frameShape(box('❯').join('\n'), null, OURS);
    expect(a.hash).toMatch(FRAME_SHAPE_HEX);
    expect(frameShape(box('❯').join('\n'), null, OURS).hash).toBe(a.hash);
    expect(frameShape(box('❯', '').join('\n'), null, OURS).hash).not.toBe(a.hash);
  });
  it('a trailing empty line, as a pane read ends, is not a row', () => {
    expect(frameShape(box('❯').join('\n') + '\n', null, OURS)).toEqual(frameShape(box('❯').join('\n'), null, OURS));
  });
  it('the version is computed from the rule\'s answers on its probes: 16 hex, and a rule that answers otherwise has another', () => {
    expect(FRAME_SHAPE_VERSION).toMatch(FRAME_SHAPE_HEX);
    expect(frameShapeVersionOf(frameShape)).toBe(FRAME_SHAPE_VERSION);
    const noDim: typeof frameShape = (t, c, o) => { const s = frameShape(t, c, o); return { ...s, tokens: s.tokens.map((x) => x.replace('~', '')) }; };
    const noCursor: typeof frameShape = (t, c, o) => { const s = frameShape(t, c, o); return { ...s, tokens: s.tokens.slice(0, -1) }; };
    const noCollapse: typeof frameShape = (t, c, o) => { const s = frameShape(t, c, o); return { ...s, tokens: s.tokens.map((x) => x.replace('+', '')) }; };
    for (const m of [noDim, noCursor, noCollapse]) expect(frameShapeVersionOf(m)).not.toBe(FRAME_SHAPE_VERSION);
  });
});

describe('what the tokens keep: no word of our text or of another row (plan section 2, section 7)', () => {
  it('a marker in a row of our text, an X row and a blank-looking row reaches no token', () => {
    const MARK = 'QMARKQ';
    const ours = [`frames row 001 ${MARK} abc`];
    const s = frameShape([`  notice ${MARK} here`, ...box(`❯ frames row 001 ${MARK} abc`, `  frames row 001 ${MARK} abc`, `  hint ${MARK}`)].join('\n'), [0, 2], ours);
    expect(JSON.stringify(s.tokens)).not.toContain(MARK);
  });
  it('every part of the recipe has its own fixed texts, which the shape reads as ours', () => {
    for (const p of FRAMES_PARTS) {
      const ours = framesOurs(p.case, p.pane);
      const last = ours[ours.length - 1]!;
      expect(frameShape(box(`  ${last}`).join('\n'), null, ours).tokens[1]).toBe('T');
    }
  });
});

// The coordinator's ruling 3 on step 1: the shape's our-text class and the reducer's rule 2 are the one function.
describe('the our-text class is the reducer\'s rule 2, by the reducer\'s own exports', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  it('the shape file takes rowIsOurs, oursSquashed and spans from the reducer and spells no squash or decoration walk of its own', () => {
    const src = readFileSync(path.join(here, '..', '..', 'shared', 'framesShape.ts'), 'utf8');
    expect(src).toMatch(/import \{[^}]*\boursSquashed\b[^}]*\browIsOurs\b[^}]*\bspans\b[^}]*\} from '\.\/framesReduce\.js';/);
    expect(src).not.toMatch(/replace\(\/\\s\+\/g, ''\)/);
    expect(src).not.toMatch(/function (squash|spans|edgesOf)\b/);
  });
  it('over a mixed set of rows, a row is T exactly when it is not a rule, chip or glyph row and rule 2 calls it ours', () => {
    const rows = ['  frames row 002 of 003 abcdefghij', '⏺ frames earlier turn ZQX-END-turn', '  frames row 002', '  hint words', 'abc', '│ frames row 003 of 003 abcdefghij │',
      '  frames row 002 of 003 abcdefghij and more', '   ', '⎿', '  ccrc frames', 'ZQX'];
    for (const r of rows) {
      const isT = inBox(box(r))[1]!.startsWith('T');
      expect(isT, r).toBe(!isRuleRow(r) && !r.includes(FRAME_CHIP_LABEL) && !/^[\s│]*[❯>]/.test(r) && rowIsOurs(r, oursSquashed(OURS)));
    }
  });
});

describe('the paste label is the send\'s (a copy across the ring boundary, plan section 8)', () => {
  it('the send\'s PASTE_CHIP is the escaped label followed by a digit run', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const send = readFileSync(path.join(here, '..', 'src', 'inject', 'send.ts'), 'utf8');
    const src = /^const PASTE_CHIP = \/\^(.+)\/;$/m.exec(send)?.[1];
    expect(src).toBe(FRAME_CHIP_LABEL.replace(/[[\]]/g, '\\$&') + '\\d+');
  });
});
