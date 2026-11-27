// The box frames recipe's reducer and the receiver's check (Desktop polish wave 187; plan
// docs/superpowers/plans/2026-11-26-box-frames-recipe.md section 5.2; the capture owner's calls 1549 and 1558, and its yes to
// packet 2 with the corrected rule 2). One case or more per rule, the owner's four rule-2 cases, the coordinator's two
// rule-row cases, idempotence, and the over-replacement on the recorded 2.1.300 panes, pinned as measured.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANARY } from '../../shared/private-names.mjs';
import { framesScan } from '../../shared/framesScan.mjs';
import { FRAMES_NUDGE_TEXT, FRAMES_RECIPE_VERSION, framesOurs } from '../../shared/framesCapture.js';
import { FRAMES_PARTS, frameSize, FRAMES_VERSION_SHAPE } from '../../shared/framesResult.js';
import {
  FRAMES_DECORATION, FRAMES_REPLACED, FRAMES_STATUS_TEXT, FRAMES_WIDE_RANGES, PATH_LIKE, checkReducedFrame, credentialShaped, frameCellWidth, isRuleRow, reduceFrame,
  reducerFingerprint, rowIsOurs, runsToTheEdge, statusRowOf, type FramesScan,
} from '../../shared/framesReduce.js';

const ESC = '\x1b';
const PANE = { cols: 220, rows: 50 };
const NONE: FramesScan = () => false;
const COMMITTED: FramesScan = framesScan;
const OURS = ['frames row 001 of 003 abcdefghij', 'frames earlier turn ZQX-END-turn', FRAMES_NUDGE_TEXT];
/** The capture's status row, which sits directly under the frame's lowest rule (rule 8, review 4069's F3). */
const STATUS = `  ${FRAMES_STATUS_TEXT}`;
/** The box's lower rule as a frame draws it, the status row under it. */
const LOWER = '─'.repeat(60);
/** A frame of `rows` exactly as given: for the cases that draw their own rules and status row. */
const raw = (...rows: string[]): string => rows.join('\n') + '\n';
/** A frame of `rows` above the box's lower rule and the capture's status row, as every recipe frame ends (rule 8), so a
 *  case's rows are its first rows. */
const frame = (...rows: string[]): string => raw(...rows, LOWER, STATUS);
const reduced = (f: string, privates: readonly string[] = [], ours: readonly string[] = OURS): string => {
  const r = reduceFrame(f, PANE, ours, privates, NONE);
  if (r.kind !== 'reduced') throw new Error(`refused: ${r.refusal}`);
  return r.text;
};
const width = (row: string): number => Array.from(row.replace(/\x1b\[[0-9;:]*m/g, '')).length;
const plainOf = (row: string): string => row.replace(/\x1b\[[0-9;:]*m/g, '');
/** The recorded panes (each holds SGR only, measured). */
const PANES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'panes');
/** A recorded pane's real size, measured as the reader measures it: its rows and its widest row. */
const realPane = (recorded: string): { cols: number; rows: number } => {
  const s = frameSize(recorded);
  return { cols: s.width, rows: s.rows };
};
/** A recorded pane as the recipe meets it (review 4086, F-H): under the capture's settings the status row is drawn directly
 *  under the lowest rule (rule 8), a NEW row, so the pane's top row scrolls off and the frame keeps the pane's real height.
 *  Every other row the build drew is kept. Every recorded pane has a rule row (pinned below), so none is left as it is. */
const asTheRecipeMeetsIt = (recorded: string): string => {
  const rows = recorded.split('\n');
  let low = -1;
  rows.forEach((l, i) => { if (isRuleRow(plainOf(l))) low = i; });
  if (low < 1) throw new Error('a recorded pane with no rule row under its top row');
  return [...rows.slice(1, low + 1), STATUS, ...rows.slice(low + 1)].join('\n');
};

describe('rule 1: the shape gate', () => {
  it('refuses a frame with a hyperlink, never strips it', () => {
    expect(reduceFrame(frame(`${ESC}]8;;x${ESC}\\link`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
  });
  it('refuses a frame over the cap', () => {
    expect(reduceFrame(frame('x'.repeat(221)), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
  });
  // Review 4069's F1, the coordinator's ruling: by Unicode class, one case per class, on a row that is ours and on one that is not.
  for (const [name, c] of [
    ['a C1 control (a one-character CSI)', '\u009b'], ['a format character (a bidi isolate)', '⁦'], ['a format character (a joiner)', '‍'],
    ['the line separator', ' '], ['the paragraph separator', ' '], ['a lone surrogate', '\ud800'], ['a private-use character', ''],
  ] as const) {
    it(`refuses a frame holding ${name} whole, on our row and on a foreign one, here and in the receiver's check`, () => {
      expect(reduceFrame(frame(`❯ frames row 001 of 003${c} abcdefghij`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
      expect(reduceFrame(frame(`  plain${c} row`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
      expect(checkReducedFrame(frame(`  plain${c} row`), PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'not-a-frame' });
    });
  }
});

describe('a wrap through a private string or a path (review 4069, F2, the coordinator\'s ruling)', () => {
  const HOME = '/home/user-a';
  const WORK = '/srv/capture-x/work';
  // The box's strings as the runner gives them: the home, the user, the host and its short form, the capture's working directory.
  const BOX = [HOME, 'user-a', 'host-a.example', 'host-a', WORK];
  const refusedHere = (f: string, privates: readonly string[] = BOX): unknown => reduceFrame(f, PANE, OURS, privates, NONE);
  const REFUSED = { kind: 'refused', refusal: 'private-shape' };

  it('the reviewer\'s first frame: a home path wrapped across two rows is refused whole on the box', () => {
    expect(refusedHere(frame('working in /home/use', 'r-a/projects/x', 'ter/work'))).toEqual(REFUSED);
  });
  it('the reviewer\'s second frame: a path wrapped after the private string is refused whole on the box', () => {
    expect(refusedHere(frame(`cwd ${HOME}/proj`, 'ectname/src'))).toEqual(REFUSED);
  });
  for (const p of BOX) {
    it(`every split point of ${p}, with and without colour codes between the halves, refuses the frame whole`, () => {
      const cps = Array.from(p);
      for (let k = 1; k < cps.length; k++) {
        const [head, tail] = [cps.slice(0, k).join(''), cps.slice(k).join('')];
        expect(refusedHere(frame(`  some text ${head}`, `${tail} more text`)), `${head}|${tail}`).toEqual(REFUSED);
        expect(refusedHere(frame(`  some text ${head}${ESC}[0m`, `${ESC}[2m${tail} more text`)), `${head}|SGR|${tail}`).toEqual(REFUSED);
        expect(refusedHere(frame(`│ some text ${head} │`, `│ ${tail} more text │`)), `${head}|border|${tail}`).toEqual(REFUSED);
      }
    });
  }
  it('a path-like token run to a full-width row\'s last column and going on below is refused whole, with no string known', () => {
    const edge = `  see ${'x'.repeat(PANE.cols - 14)} /srv/ab`;
    expect(Array.from(edge)).toHaveLength(PANE.cols);
    expect(refusedHere(frame(edge, 'cdef rest'), [])).toEqual(REFUSED);
    expect(checkReducedFrame(frame(edge, 'cdef rest'), PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('a full-width row of words, or a rule row, above a row that begins with a slash is not a wrapped path', () => {
    const words = `  ${'word '.repeat(43)}wor`;
    expect(Array.from(words)).toHaveLength(PANE.cols);
    expect(reduced(frame(words, 'next words'))).toBe(frame(words, 'next words'));
    const ruled = raw('─'.repeat(PANE.cols), '  /help for help', '─'.repeat(30), STATUS);
    expect(reduced(ruled)).toBe(ruled);
  });

  // The server has none of the box's strings: it refuses by shape what a box without the fix sent.
  it('the receiver refuses the reviewer\'s first frame as the box sent it before this round: a token cut at a row\'s end', () => {
    const sent = frame(`${FRAMES_REPLACED.cwd} `, `${Array.from(FRAMES_REPLACED.cwd).slice(0, 16).join('')}`, 'ter/work');
    expect(checkReducedFrame(sent, PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('the receiver refuses the reviewer\'s second frame as the box sent it before this round: a whole token, then a row going on with a path', () => {
    const sent = frame(`${FRAMES_REPLACED.cwd}${' '.repeat(2)}`, 'ectname/src');
    expect(checkReducedFrame(sent, PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('the class: a cut token anywhere, either end, and a path\'s tail after any token or after a row run to the edge', () => {
    for (const f of [frame('  see ‹model here'), frame('  odel› and more'), frame('  ‹working dir› x'), frame(`  ${FRAMES_REPLACED.model} then ‹acc`)]) {
      expect(checkReducedFrame(f, PANE, OURS, NONE), f).toEqual({ ok: false, refusal: 'private-shape' });
    }
    for (const t of Object.values(FRAMES_REPLACED)) {
      expect(checkReducedFrame(frame(`│ ${t}     │`, '│ a/b more │'), PANE, OURS, NONE), t).toEqual({ ok: false, refusal: 'private-shape' });
    }
    const edge = `  ${'x'.repeat(PANE.cols - 2)}`;
    expect(checkReducedFrame(frame(edge, 'yz/q'), PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
  });
  it('a whole token with no path after it, and a path row after a row of ours, pass the receiver', () => {
    expect(checkReducedFrame(frame(`  ${FRAMES_REPLACED.model}  `, '  ? for shortcuts'), PANE, OURS, NONE)).toEqual({ ok: true });
    expect(checkReducedFrame(frame(`> ${FRAMES_NUDGE_TEXT.slice(0, 60)}`, `  ${FRAMES_NUDGE_TEXT.slice(60, 120)}`), PANE, OURS, NONE)).toEqual({ ok: true });
  });
  it('our own text wrapped at exactly the pane\'s width inside a path is ours on both rows, and reduces unchanged (review 4086, F-G)', () => {
    // The mail notice holds `~/.local/bin/…`; a turn of ours wrapped inside that path runs to the last column, and the row
    // under it goes on with the path. Both rows are ours, so the full-width rule does not read them as a wrapped path.
    const k = FRAMES_NUDGE_TEXT.indexOf('~/.local/bin/') + 5;
    const a = `${' '.repeat(PANE.cols - k - 2)}> ${FRAMES_NUDGE_TEXT.slice(0, k)}`;
    const b = `  ${FRAMES_NUDGE_TEXT.slice(k, k + 150)}`;
    expect([Array.from(a).length, a.endsWith('~/.lo'), b.trimStart().startsWith('cal/bin/')]).toEqual([PANE.cols, true, true]);
    expect(reduced(frame(a, b))).toBe(frame(a, b));
    expect(checkReducedFrame(frame(a, b), PANE, OURS, NONE)).toEqual({ ok: true });
  });
});

describe('the full-width rule counts screen cells, two for a wide character (review 4086, F-B, the coordinator\'s ruling)', () => {
  const P = { cols: 40, rows: 8 };
  const boxed = (...rows: string[]): string => raw(...rows, '─'.repeat(P.cols), STATUS);
  const both = (f: string): unknown[] => [reduceFrame(f, P, [], [], NONE), checkReducedFrame(f, P, [], NONE)];
  const REFUSED = [{ kind: 'refused', refusal: 'private-shape' }, { ok: false, refusal: 'private-shape' }];
  it('the reviewer\'s frame: a row that reaches the last column with a wide character, a path going on below, refuses on both hosts', () => {
    const edge = `🎯${'x'.repeat(33)} /pro`;
    expect(Array.from(edge)).toHaveLength(P.cols - 1); // 39 code points, 40 cells
    expect(both(boxed(edge, 'ject-x rest'))).toEqual(REFUSED);
    const cjk = `${'漢'.repeat(17)}x /pro`; // 23 code points, 40 cells
    expect(both(boxed(cjk, 'ject-x rest'))).toEqual(REFUSED);
  });
  it('an ASCII row run to the last column still refuses', () => {
    const edge = `${'x'.repeat(35)} /pro`;
    expect(Array.from(edge)).toHaveLength(P.cols);
    expect(both(boxed(edge, 'ject-x rest'))).toEqual(REFUSED);
  });
  it('a row of wide characters one cell short of the edge is not run to it, and reduces unchanged', () => {
    const short = `${'漢'.repeat(17)} /pro`; // 39 cells
    const f = boxed(short, 'ject-x rest');
    expect(both(f)).toEqual([{ kind: 'reduced', text: f, replaced: { cwd: 0, path: 0, model: 0, account: 0 } }, { ok: true }]);
  });
});

describe('the wide table is the Unicode East Asian Width table (review 4109, R1, the coordinator\'s rulings 1 and 2 on wave 195)', () => {
  const FIXTURE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'unicode-east-asian-width.txt'), 'utf8');
  const SHARED = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'shared', 'framesReduce.ts'), 'utf8');
  const DATA_LINE = /^([0-9A-F]{4,6})(?:\.\.([0-9A-F]{4,6}))?\s*;\s*([WF])\s+#/;
  /** The fixture's W and F lines, parsed, sorted and merged where adjacent: what the shared table must be. */
  const fromFixture = (): [number, number][] => {
    const lines = FIXTURE.split('\n').filter((l) => l !== '' && !l.startsWith('#'));
    const raw = lines.map((l) => {
      const m = DATA_LINE.exec(l);
      if (m === null) throw new Error(`not a W or F line of the data file: ${l}`);
      return [parseInt(m[1]!, 16), parseInt(m[2] ?? m[1]!, 16)] as [number, number];
    });
    expect(raw).toHaveLength(293);
    raw.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const [a, b] of raw) {
      const last = merged[merged.length - 1];
      if (last !== undefined && a <= last[1] + 1) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    }
    return merged;
  };
  /** The shared file's table as source text, and as the generator writes it from the fixture: eight pairs to a line. */
  const tableText = (): string => {
    const open = SHARED.indexOf('export const FRAMES_WIDE_RANGES');
    const start = SHARED.indexOf('\n', open) + 1;
    return SHARED.slice(start, SHARED.indexOf(']);', start));
  };
  const generated = (ranges: readonly (readonly [number, number])[]): string => {
    const hex = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;
    const items = ranges.map(([a, b]) => `[${hex(a)}, ${hex(b)}]`);
    const lines: string[] = [];
    for (let i = 0; i < items.length; i += 8) lines.push(`  ${items.slice(i, i + 8).join(', ')},\n`);
    return lines.join('');
  };
  /** What the function answers for a character the table does not list: the engine's two classes (ruling 2). */
  const besideTheTable = (c: string): 1 | 2 => (/\p{Emoji_Presentation}|\p{Cn}/u.test(c) ? 2 : 1);

  it('the fixture carries its data file\'s own name and date lines, and the shared file names the same file', () => {
    expect(FIXTURE.split('\n').slice(0, 2)).toEqual(['# EastAsianWidth-17.0.0.txt', '# Date: 2025-07-24, 00:12:54 GMT']);
    expect(SHARED).toContain('EastAsianWidth-17.0.0.txt');
  });
  it('the shared table is the fixture\'s W and F ranges merged, as the generator writes them: they cannot drift', () => {
    const want = fromFixture();
    expect(want).toHaveLength(123);
    expect(tableText()).toBe(generated(want));
    expect(FRAMES_WIDE_RANGES.map(([a, b]) => [a, b])).toEqual(want);
  });
  it('the shared table\'s source text is ASCII only, byte for byte', () => {
    const bytes = [...new TextEncoder().encode(tableText())];
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.filter((b) => b > 0x7f)).toEqual([]);
  });
  it('the engine\'s Unicode version is not newer than the table\'s, so nothing it has assigned is missing from the table', () => {
    const [maj, min] = (process.versions.unicode ?? '0.0').split('.').map(Number) as [number, number];
    expect(maj * 100 + (min ?? 0)).toBeLessThanOrEqual(1700);
  });
  it('every range of the fixture, first, last and one inside, is two cells; the code point just outside each is what the rest of the function gives', () => {
    const ranges = fromFixture();
    const inTable = (cp: number): boolean => ranges.some(([a, b]) => cp >= a && cp <= b);
    let outside = 0;
    for (const [a, b] of ranges) {
      for (const cp of [a, b, a + ((b - a) >> 1)]) expect(frameCellWidth(String.fromCodePoint(cp)), cp.toString(16)).toBe(2);
      for (const cp of [a - 1, b + 1]) {
        if (cp < 0 || cp > 0x10ffff || inTable(cp)) continue;
        const c = String.fromCodePoint(cp);
        expect(frameCellWidth(c), cp.toString(16)).toBe(besideTheTable(c));
        outside++;
      }
    }
    expect(outside).toBe(246);
  });
  it('the reviewer\'s and the panel\'s unlisted wide characters are two cells now, and so is a regional indicator, which the table gives N', () => {
    for (const cp of [0x2329, 0xfe10, 0xa960, 0x16fe0, 0x17000, 0x1b000, 0x1f200, 0xac00, 0xff01]) {
      expect(frameCellWidth(String.fromCodePoint(cp)), cp.toString(16)).toBe(2);
    }
    // U+1F1E6..1F1FF are emoji drawn as one (Emoji_Presentation) and N in the data file: the engine's class counts them.
    expect(FRAMES_WIDE_RANGES.some(([a, b]) => 0x1f1e6 >= a && 0x1f1e6 <= b)).toBe(false);
    expect(frameCellWidth(String.fromCodePoint(0x1f1e6))).toBe(2);
  });
  it('unknown is wide on purpose: an unassigned code point and a noncharacter count two cells; a private-use one is refused by the shape gate before any width is asked', () => {
    // Ruling 2: U+0378 is unassigned, U+FDD0 a noncharacter (both Cn, which the class rule lets through); U+E000 is private use (Co).
    for (const cp of [0x0378, 0xfdd0, 0x1ffff]) expect(frameCellWidth(String.fromCodePoint(cp)), cp.toString(16)).toBe(2);
    const P = { cols: 20, rows: 8 };
    const boxed = (...rows: string[]): string => raw(...rows, '─'.repeat(P.cols), STATUS);
    // Reaching the edge through an unassigned code point refuses a path going on below, on both hosts.
    const edge = `ab/${'c'.repeat(15)}${String.fromCodePoint(0x0378)}`;
    expect(reduceFrame(boxed(edge, 'tail rest'), P, [], [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
    expect(checkReducedFrame(boxed(edge, 'tail rest'), P, [], NONE)).toEqual({ ok: false, refusal: 'private-shape' });
    // A private-use code point there is refused whole by rule 1 first, on both hosts; were it asked, it would count one cell.
    const pua = `ab/${'c'.repeat(16)}${String.fromCodePoint(0xe000)}`;
    expect(reduceFrame(boxed(pua, 'tail rest'), P, [], [], NONE)).toEqual({ kind: 'refused', refusal: 'not-a-frame' });
    expect(checkReducedFrame(boxed(pua, 'tail rest'), P, [], NONE)).toEqual({ ok: false, refusal: 'not-a-frame' });
    expect(frameCellWidth(String.fromCodePoint(0xe000))).toBe(1);
  });
});

describe('the capture owner\'s condition: a row truly at the edge is at the edge (review 4109, R1, the coordinator\'s rulings 3 and 4 on wave 195)', () => {
  // Pane 20 wide, the reviewer's measured frames: `ab/` and filler reach the last column, and `tail` goes on below. No
  // private string is known, so only the full-width rule can refuse them. Each is refused whole on the box (`reduceFrame`)
  // and by the server's check (`checkReducedFrame`): the one function.
  const P = { cols: 20, rows: 8 };
  const boxed = (...rows: string[]): string => raw(...rows, '─'.repeat(P.cols), STATUS);
  const both = (f: string): unknown[] => [reduceFrame(f, P, [], [], NONE), checkReducedFrame(f, P, [], NONE)];
  const REFUSED = [{ kind: 'refused', refusal: 'private-shape' }, { ok: false, refusal: 'private-shape' }];
  const KEPT = (f: string): unknown[] => [{ kind: 'reduced', text: f, replaced: { cwd: 0, path: 0, model: 0, account: 0 } }, { ok: true }];
  const WIDE = String.fromCodePoint(0x6f22);

  it('a row reaching the last column through a wide character outside the old hand list, then a continued path tail, refuses on both hosts', () => {
    for (const cp of [0x2329, 0xfe10, 0xa960, 0x16fe0, 0x17000, 0x1b000, 0x1f200]) {
      const edge = `ab/${'c'.repeat(15)}${String.fromCodePoint(cp)}`; // 19 code points, 20 cells
      expect(both(boxed(edge, 'tail rest')), cp.toString(16)).toEqual(REFUSED);
    }
  });
  it('a straddler at the last column, then a continued tail: the row ends one cell short as drawn, with no trailing space, and refuses on both hosts', () => {
    const short = `ab/${'c'.repeat(16)}`; // 19 cells: the wide character did not fit in the last cell and was wrapped whole
    expect(both(boxed(short, `${WIDE}tail rest`))).toEqual(REFUSED);
  });
  it('the same straddle with the blank last cell read as a trailing space: measured after trailing spaces are dropped, it refuses on both hosts', () => {
    const drawn = `ab/${'c'.repeat(16)} `; // 20 code points as drawn, 19 cells once the trailing space is dropped
    expect(both(boxed(drawn, `${WIDE}tail rest`))).toEqual(REFUSED);
  });
  it('a row one cell short whose next row begins with a narrow character is a short row, not a wrap, and is kept', () => {
    // The narrow character would have fitted in the last cell, so the terminal did not wrap there.
    const short = `ab/${'c'.repeat(16)}`;
    expect(both(boxed(short, 'tail rest'))).toEqual(KEPT(boxed(short, 'tail rest')));
  });
  it('a row two cells short, even with a wide character below, is kept', () => {
    const short = `ab/${'c'.repeat(15)} `;
    expect(both(boxed(short, `${WIDE}tail rest`))).toEqual(KEPT(boxed(short, `${WIDE}tail rest`)));
  });
});

describe('a bare quote is Claude Code\'s own glyph, and a cut token is exact (review 4086, F-A, the coordinator\'s ruling)', () => {
  const NAMES = Object.values(FRAMES_REPLACED).map((t) => Array.from(t).slice(1, -1).join(''));
  const both = (f: string): unknown[] => [reduceFrame(f, PANE, OURS, [], NONE), checkReducedFrame(f, PANE, OURS, NONE)];
  const KEPT = (f: string): unknown[] => [{ kind: 'reduced', text: f }, { ok: true }];
  const REFUSED = [{ kind: 'refused', refusal: 'private-shape' }, { ok: false, refusal: 'private-shape' }];
  it('the two recorded held-stash panes, as the recipe meets them at their real size, reduce and keep the stash notice row byte for byte, on both hosts', () => {
    for (const f of ['stash-held-with-text.ansi', 'stash-held-during-turn.ansi']) {
      const recorded = readFileSync(path.join(PANES, 'box', f), 'utf8');
      const pane = realPane(recorded);
      expect(pane, f).toEqual({ cols: 220, rows: 50 });
      const text = asTheRecipeMeetsIt(recorded);
      const r = reduceFrame(text, pane, [], [], NONE);
      expect(r.kind, f).toBe('reduced');
      if (r.kind !== 'reduced') continue;
      const rows = text.split('\n');
      const notice = rows.findIndex((l) => plainOf(l).trim().startsWith('› stashed'));
      expect(notice, f).toBeGreaterThan(0);
      expect(r.text.split('\n')[notice], f).toBe(rows[notice]);
      // The one row replaced is the header's model and plan row, rule 5's, measured.
      expect(r.replaced, f).toEqual({ cwd: 0, path: 0, model: 1, account: 0 });
      expect(checkReducedFrame(r.text, pane, [], NONE), f).toEqual({ ok: true });
    }
  });
  it('a bare closing quote at a row\'s start, in mid-row and at its end is kept, and so is a bare opening quote', () => {
    for (const row of ['  › stashed · ✔ Update installed · Restart to update', '  one › two', '  it ends here ›', '  ›', '  ‹ opens here', '  a ‹ b › c']) {
      expect(both(frame(row)), row).toMatchObject(KEPT(frame(row)));
    }
  });
  it('each proper prefix of each name after the opening quote, and each proper suffix before the closing one, refuses on both hosts', () => {
    const rows = (head: string, tail: string): string[] => [`  see ${head} here`, `  ${head}`, `  x ${tail} and more`, `  ${tail}`];
    for (const n of NAMES) {
      const cps = Array.from(n);
      for (let k = 1; k < cps.length; k++) {
        for (const row of rows(`‹${cps.slice(0, k).join('')}`, `${cps.slice(cps.length - k).join('')}›`)) expect(both(frame(row)), row).toEqual(REFUSED);
      }
    }
    // The whole name with its other quote missing is a cut too: it is what a row too narrow for its token would leave. (A row
    // holding the whole word `account` is rule 6's, which replaces it on the box, so that name is not among these.)
    for (const n of NAMES.filter((x) => x !== 'account')) for (const row of rows(`‹${n}`, `${n}›`)) expect(both(frame(row)), row).toEqual(REFUSED);
  });
  it('a cut token after an earlier bare quote of the same kind in the same row still refuses on both hosts (review 4109, F3)', () => {
    // Every quote of a row is examined, not only its first: a bare `›` (or `‹`) before the cut does not hide it.
    for (const n of NAMES) {
      const cps = Array.from(n);
      for (let k = 1; k < cps.length; k++) {
        const tail = `${cps.slice(cps.length - k).join('')}›`;
        const head = `‹${cps.slice(0, k).join('')}`;
        for (const row of [`  one › two ${tail} more`, `  › x ›  ${tail}`, `  a ‹ b ${head} here`, `  ‹ ‹ ${head}`]) expect(both(frame(row)), row).toEqual(REFUSED);
      }
    }
  });
  it('a complete token is kept: alone, and, for the two no word rule reads, between words and twice in a row', () => {
    // `‹account›` holds the word rule 6 reads, so a row holding more than that token is that rule's, as before this round.
    for (const t of Object.values(FRAMES_REPLACED)) expect(both(frame(`  ${t}${' '.repeat(30)}`)), t).toMatchObject(KEPT(frame(`  ${t}${' '.repeat(30)}`)));
    for (const t of [FRAMES_REPLACED.cwd, FRAMES_REPLACED.model]) {
      for (const row of [`  see ${t} here and more`, `  ${t}${t}${' '.repeat(10)}`]) expect(both(frame(row)), row).toMatchObject(KEPT(frame(row)));
    }
  });
});

describe('a short user or host name is matched as a whole word (review 4069, F4, the coordinator\'s ruling)', () => {
  it('a name of one to three characters, bounded by the edge or a character not a letter, digit, dot, dash or underscore, is replaced', () => {
    for (const [name, row] of [['bo', '  logged in as bo today'], ['b', '  user b on this box now'], ['srv', '  (srv) answered from here']] as const) {
      expect(reduced(frame(row), [name]).split('\n')[0]!.trim(), row).toBe(FRAMES_REPLACED.cwd);
    }
  });
  it('inside a longer word, or joined by a dot, dash or underscore, it is not the name', () => {
    for (const row of ['  bob and boat are here', '  see bo.x and bo-y and bo_z', '  x9bo and bo9']) expect(reduced(frame(row), ['bo'])).toBe(frame(row));
  });
  it('a longer name is matched anywhere, as before', () => {
    expect(reduced(frame('  xuser-ax here and more words'), ['user-a']).split('\n')[0]!.trim()).toBe(FRAMES_REPLACED.cwd);
  });
  it('a short name wrapped across two rows is refused whole', () => {
    expect(reduceFrame(frame('  logged in as b', 'o today'), PANE, OURS, ['bo'], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
  });
});

describe('rule 2: ours after the closed decoration list (the owner\'s four cases)', () => {
  it('a box row with its glyph and our text is kept byte for byte, SGR and all', () => {
    const row = `${ESC}[2m❯ ${ESC}[0mframes row 001 of 003 abcdefghij   `;
    expect(reduced(frame(row))).toBe(frame(row));
  });
  it('an earlier turn\'s row of the mail notice, with its marker, is kept: path and all', () => {
    const row = `${ESC}[48;5;237m> ${FRAMES_NUDGE_TEXT.slice(0, 200)}${ESC}[0m`;
    expect(reduced(frame(row))).toBe(frame(row));
  });
  it('the same row with one foreign word after our text is read by the later rules, and replaced', () => {
    const row = `> ${FRAMES_NUDGE_TEXT.slice(0, 150)} intruder`;
    const out = reduced(frame(row)).split('\n')[0]!;
    expect(out.startsWith(`> ${FRAMES_REPLACED.cwd}`)).toBe(true);
    expect(width(out)).toBe(width(row));
  });
  it('a row holding only decoration is not ours', () => {
    expect(rowIsOurs('│      │', OURS.map((o) => o.replace(/\s+/g, '')))).toBe(false);
    expect(rowIsOurs('❯ ', OURS.map((o) => o.replace(/\s+/g, '')))).toBe(false);
  });
  it('a wrapped turn\'s fragment is ours', () => {
    expect(rowIsOurs(`  ${FRAMES_NUDGE_TEXT.slice(40, 120)}`, [FRAMES_NUDGE_TEXT.replace(/\s+/g, '')])).toBe(true);
  });
  it('the decoration list is closed: borders, the glyph, the turn markers and spaces', () => {
    expect(FRAMES_DECORATION).toEqual(['│', '╭', '╮', '╰', '╯', '❯', '>', '⏺', '●', '⎿', ' ', ' ']);
  });
});

describe('rules 3 to 6: a row replaced keeps its width and its border', () => {
  it('rule 3: an exact private string', () => {
    const row = '│ cwd: /srv/capture-x/captures/abc │';
    const out = reduced(frame(row), ['/srv/capture-x']).split('\n')[0]!;
    expect(out).toBe(`│ ${FRAMES_REPLACED.cwd}${' '.repeat(width(row) - 4 - width(FRAMES_REPLACED.cwd))} │`);
  });
  it('rule 4: a path cut short, with an ellipsis or a home mark, or two components', () => {
    for (const row of ['  …/projects/x and more words', '  ~/work here and more words', '  in work/projects/x now and later', '  /a/b and some more words']) {
      const out = reduced(frame(row)).split('\n')[0]!;
      expect(out.trim()).toBe(FRAMES_REPLACED.cwd);
      expect(width(out)).toBe(width(row));
    }
  });
  it('a row too narrow for its whole token refuses the frame: a token is never cut short to fit (review 4069, F2)', () => {
    // Before this round such a row became the token's first characters (`‹wo`), which the server cannot tell from a cut.
    for (const row of ['  …/projects/x', '  ~/work here', '  /a/b', '  Haiku', '  plan']) {
      expect(reduceFrame(frame(row), PANE, OURS, [], NONE), row).toEqual({ kind: 'refused', refusal: 'private-shape' });
    }
  });
  it('a replaced row is measured in screen cells: wide content as wide as the token is replaced, and keeps its width on screen (review 4109, F5)', () => {
    const cells = (row: string): number => Array.from(plainOf(row)).reduce((n, c) => n + frameCellWidth(c), 0);
    // Ten wide characters and a path: 15 code points but 25 cells, wider than the 19-cell token, so it is replaced, not refused.
    const row = `  ${'漢'.repeat(10)} /a/b`;
    const out = reduced(frame(row)).split('\n')[0]!;
    expect(out.trim()).toBe(FRAMES_REPLACED.cwd);
    expect(cells(out)).toBe(cells(row));
    expect(checkReducedFrame(reduced(frame(row)), PANE, OURS, NONE)).toEqual({ ok: true });
    // Four wide characters and the path are 13 cells, narrower than the token: refused, as before.
    expect(reduceFrame(frame(`  ${'漢'.repeat(4)} /a/b`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
  });
  it('rule 5: a model name, rule 6: an account or a plan', () => {
    expect(reduced(frame('  Haiku 9.9 · whatever')).split('\n')[0]!.trim()).toBe(FRAMES_REPLACED.model);
    expect(reduced(frame('  API Usage Billing')).split('\n')[0]!.trim()).toBe(FRAMES_REPLACED.account);
    expect(reduced(frame('  Claude Max')).split('\n')[0]!.trim()).toBe(FRAMES_REPLACED.account);
  });
  it('a plain build row is kept', () => {
    expect(reduced(frame('  ? for shortcuts'))).toBe(frame('  ? for shortcuts'));
  });
});

describe('rule 7: a rule row\'s label is kept byte for byte (the coordinator\'s condition 2)', () => {
  const rule = `${ESC}[38;5;244m${'─'.repeat(90)} ↑ 156 more ${'─'.repeat(90)}${ESC}[0m`;
  it('a rule row carrying an arrow, a number and a word survives reduction unchanged', () => {
    expect(reduced(frame(rule))).toBe(frame(rule));
  });
  it('the path rule does not read that label as a path', () => {
    expect(PATH_LIKE.test('↑ 156 more')).toBe(false);
    expect(isRuleRow(rule.replace(/\x1b\[[0-9;]*m/g, ''))).toBe(true);
  });
  it('a rule row whose label rules 4 to 6 would catch refuses the frame: never kept, never rewritten', () => {
    for (const label of ['…/work/x', 'Haiku 9', 'Claude Max']) {
      expect(reduceFrame(frame(`${'─'.repeat(20)} ${label} ${'─'.repeat(20)}`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
    }
  });
  it('a rule row holding a private string is replaced', () => {
    const out = reduced(frame(`${'─'.repeat(20)} /srv/capture-x ${'─'.repeat(20)}`), ['/srv/capture-x']);
    expect(out).toContain(FRAMES_REPLACED.cwd);
  });
});

describe('rule 8: the status position holds exactly the capture\'s status text (review 4069, F3, the capture owner\'s condition)', () => {
  const RULE = '─'.repeat(60);
  const box = (...under: string[]): string => raw(RULE, '❯ frames row 001 of 003 abcdefghij', RULE, ...under);
  const REFUSED = { kind: 'refused', refusal: 'status-row' };
  it('the text alone in that row passes, kept byte for byte, SGR and indent included, with a hint row under it', () => {
    for (const f of [box(STATUS), box(STATUS, '  ? for shortcuts'), box(`${ESC}[2m  ${FRAMES_STATUS_TEXT}${ESC}[0m   `)]) expect(reduced(f), f).toBe(f);
  });
  it('the text followed by any other text refuses the frame whole, a branch, a path or a mark at the row\'s far end', () => {
    for (const s of [`${STATUS} · main`, `${STATUS} ~/work`, `${STATUS}${' '.repeat(80)}● high`, `  ${FRAMES_STATUS_TEXT}x`]) {
      expect(reduceFrame(box(s), PANE, OURS, [], NONE), s).toEqual(REFUSED);
    }
  });
  it('a different text there refuses: the build\'s own hint, a mode row, a status of another layer, words of ours', () => {
    for (const s of ['  ? for shortcuts', '  ⏵⏵ auto mode on (shift+tab to cycle)', '  👤 cfg │ 🎯 repo', '  frames row 001 of 003 abcdefghij', `  ${FRAMES_STATUS_TEXT.slice(0, -1)}`]) {
      expect(reduceFrame(box(s), PANE, OURS, [], NONE), s).toEqual(REFUSED);
    }
  });
  it('a second status row refuses, wherever under the box it is drawn', () => {
    expect(reduceFrame(box(STATUS, STATUS), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(reduceFrame(box(STATUS, '  ? for shortcuts', `  note ${FRAMES_STATUS_TEXT} again`), PANE, OURS, [], NONE)).toEqual(REFUSED);
  });
  it('an empty status position refuses: the lowest rule is the last row, or the row under it is blank', () => {
    expect(reduceFrame(box(), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(reduceFrame(raw(RULE, '❯ x', RULE).slice(0, -1), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(reduceFrame(box('   ', STATUS), PANE, OURS, [], NONE)).toEqual(REFUSED);
  });
  it('the position is under the LOWEST rule: a status text under an upper rule only is a second row or a refused one', () => {
    expect(reduceFrame(raw(RULE, STATUS, '❯ x', RULE, '  ? for shortcuts'), PANE, OURS, [], NONE)).toEqual(REFUSED);
    expect(statusRowOf([RULE, '❯ x', RULE, STATUS, ''])).toBe(3);
  });
  it('a frame with no rule row has no box and no status position, and is refused too (the coordinator\'s change 1, 39557)', () => {
    expect(statusRowOf(['  plain row', ''])).toBe('refused');
    for (const f of [raw('  plain row'), raw(STATUS), raw('❯ frames row 001 of 003 abcdefghij', STATUS), '']) {
      expect(reduceFrame(f, PANE, OURS, [], NONE), JSON.stringify(f)).toEqual(REFUSED);
      expect(checkReducedFrame(f, PANE, OURS, NONE), JSON.stringify(f)).toEqual({ ok: false, refusal: 'status-row' });
    }
  });
  it('the server\'s check refuses the same frames, and clears the one the box keeps', () => {
    for (const f of [box(`${STATUS} · main`), box('  ? for shortcuts'), box(STATUS, STATUS), box()]) {
      expect(checkReducedFrame(f, PANE, OURS, NONE), f).toEqual({ ok: false, refusal: 'status-row' });
    }
    expect(checkReducedFrame(box(STATUS, '  ? for shortcuts'), PANE, OURS, NONE)).toEqual({ ok: true });
  });
});

describe('rule 9: the scans refuse the whole frame', () => {
  it('a hit of the committed private-name matcher', () => {
    expect(reduceFrame(frame('plain row'), PANE, OURS, [], () => true)).toEqual({ kind: 'refused', refusal: 'private-name' });
  });
  it('the shared scan finds the committed canary on a row, and on a clean frame finds nothing', () => {
    expect(reduceFrame(frame(`  note ${CANARY} here`), PANE, OURS, [], COMMITTED)).toEqual({ kind: 'refused', refusal: 'private-name' });
    expect(framesScan(frame('  ? for shortcuts', '  plain row'))).toBe(false);
  });
  it('a private shape left on a row not ours: an address, a long hex run', () => {
    expect(reduceFrame(frame('  host 10.1.2.3 here'), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
    expect(reduceFrame(frame(`  id ${'ab'.repeat(16)}`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'private-shape' });
  });
  it('the masker over the whole frame, our rows included', () => {
    const key = 'sk-ant-api03-abcdefghijkl';
    expect(reduceFrame(frame(`❯ ${key}`), PANE, [key], [], NONE)).toEqual({ kind: 'refused', refusal: 'masked' });
  });
  it('a colour change inside a key does not split it past the masker', () => {
    expect(reduceFrame(frame(`  sk-ant-${ESC}[2mapi03-abcdefghijkl${ESC}[0m`), PANE, OURS, [], NONE)).toEqual({ kind: 'refused', refusal: 'masked' });
  });
  it('loopback passes', () => {
    expect(reduced(frame('  at 127.0.0.1 only'))).toBe(frame('  at 127.0.0.1 only'));
  });
  it('no fixed text of any case trips the masker\'s shapes or the committed matcher', () => {
    for (const p of FRAMES_PARTS) for (const t of framesOurs(p.case, p.pane)) {
      expect(credentialShaped(t)).toBe(false);
      expect(COMMITTED(t)).toBe(false);
    }
  });
});

describe('rule 10, and the receiver\'s check', () => {
  const mixed = raw(
    '  Haiku 9.9 · Claude Max', '  cwd /srv/capture-x/captures/abc', `${'─'.repeat(30)} ↑ 9 more ${'─'.repeat(30)}`,
    '❯ frames row 001 of 003 abcdefghij', `${'─'.repeat(70)}`, STATUS, '  ? for shortcuts',
  );
  it('idempotent: a reduced frame reduces to itself', () => {
    const once = reduced(mixed, ['/srv/capture-x']);
    expect(reduced(once)).toBe(once);
  });
  it('the receiver clears a reduced frame', () => {
    expect(checkReducedFrame(reduced(mixed, ['/srv/capture-x']), PANE, OURS, NONE)).toEqual({ ok: true });
  });
  it('the receiver refuses a frame the reducer would still change, and one the live masker would', () => {
    expect(checkReducedFrame(mixed, PANE, OURS, NONE)).toEqual({ ok: false, refusal: 'private-shape' });
    expect(checkReducedFrame(frame('plain row'), PANE, OURS, NONE, () => true)).toEqual({ ok: false, refusal: 'masked' });
  });
  it('the version folds in the reducer\'s probe answers', () => {
    expect(FRAMES_RECIPE_VERSION).toMatch(FRAMES_VERSION_SHAPE);
  });
  it('the probe table answers for a bare quote, a wide character at the edge, a row at the probe\'s width and a straddle (review 4109, F9)', () => {
    // The four probes after the eighteen of round 2, each drawn in its box: a change in what the reducer does with any of
    // them moves the version.
    const answers = JSON.parse(reducerFingerprint()) as { kind: string; refusal?: string; text?: string }[];
    expect(answers).toHaveLength(25);
    expect(answers[18]).toMatchObject({ kind: 'reduced' });
    expect(answers[18]!.text).toContain('› stashed');
    for (const i of [19, 20, 21]) expect(answers[i], String(i)).toEqual({ kind: 'refused', refusal: 'private-shape' });
  });
});

describe('over-replacement on the recorded 2.1.300 panes (the coordinator\'s condition 3, measured and pinned)', () => {
  const dir = PANES;
  const files = readdirSync(dir).filter((f) => f.startsWith('cc300'));
  /** What the 61 recorded panes hold directly under their lowest rule, measured: each was drawn with no status line set. */
  const UNDER_THE_LOWEST_RULE = [
    '4. Chat about this', '5. Chat about this', 'paste again to expand',
    '←  ☒ Caching  ☒ Tracing  ✔ Submit  →', '←  ☒ Database  ☒ Deployment  ☒ Monitoring  ☒ Licensing  ✔ Submit  →',
    '←  ☒ Drink  ☒ Features  ☒ Tools  ✔ Submit  →', '←  ☒ Engine  ☒ Order  ☒ Notes  ☒ Region  ✔ Submit  →',
    '←  ☒ Pets  ☐ Size  ☒ Mode  ✔ Submit  →', '←  ☒ Tools  ☒ Sizes  ✔ Submit  →', '←  ☒ Tools  ✔ Submit  →',
    '⏵⏵ auto mode on (shift+tab to cycle)', '⏵⏵ auto mode on (shift+tab to cycle) · ← for agents', '❯ 4. Chat about this',
  ];
  it('ALTERED: each pane as the recipe meets it at its real size, the status row a NEW row under its lowest rule: replaces 38 model rows, 0 account rows and 5 path rows in 61 panes, never a box, rule or chip row, and keeps every width', () => {
    // The panes were not drawn under the capture's settings, so each gets the status row ours would draw
    // (`asTheRecipeMeetsIt`), at the pane's own width and height (review 4086, F-H), so the full-width rule runs too.
    const total = { cwd: 0, path: 0, model: 0, account: 0 };
    let boxReplaced = 0;
    for (const f of files) {
      const recorded = readFileSync(path.join(dir, f), 'utf8');
      const text = asTheRecipeMeetsIt(recorded);
      const r = reduceFrame(text, realPane(recorded), [], [], NONE);
      expect(r.kind, f).toBe('reduced');
      if (r.kind !== 'reduced') continue;
      for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += r.replaced[k];
      const before = text.split('\n');
      const after = r.text.split('\n');
      expect(after.map(width)).toEqual(before.map(width));
      // The box: from the last glyph row up to the rule above it, down to the closing rule.
      const plain = before.map((l) => l.replace(/\x1b\[[0-9;:]*m/g, ''));
      let g = -1;
      plain.forEach((l, i) => { if (/^\s*❯/.test(l)) g = i; });
      if (g < 0) continue;
      let top = g; while (top > 0 && !isRuleRow(plain[top - 1]!)) top--;
      let bot = g; while (bot < plain.length - 1 && !isRuleRow(plain[bot + 1]!)) bot++;
      for (let i = Math.max(0, top - 1); i <= Math.min(plain.length - 1, bot + 1); i++) if (after[i] !== before[i]) boxReplaced++;
      for (const [i, l] of plain.entries()) if (/\[Pasted text #\d+/.test(l)) expect(after[i]).toBe(before[i]);
    }
    expect(files).toHaveLength(61);
    expect(total).toEqual({ cwd: 0, path: 5, model: 38, account: 0 });
    expect(boxReplaced).toBe(0);
  });
  it('as recorded, at its real size, every pane is refused status-row: none holds the capture\'s status text under its lowest rule', () => {
    const under = new Map<string, number>();
    let ruled = 0;
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      const plain = text.split('\n').map(plainOf);
      let low = -1;
      plain.forEach((l, i) => { if (isRuleRow(l)) low = i; });
      expect(low, `${f} has a rule row`).toBeGreaterThan(0);
      ruled++;
      expect(reduceFrame(text, realPane(text), [], [], NONE), f).toEqual({ kind: 'refused', refusal: 'status-row' });
      const row = (plain[low + 1] ?? '').trim();
      under.set(row, (under.get(row) ?? 0) + 1);
    }
    expect(ruled).toBe(61);
    expect(under.has(FRAMES_STATUS_TEXT)).toBe(false);
    // What the build drew there (no status line was configured): a hint, the mode row, an ask dialog's last row, or nothing.
    expect([...under.keys()].sort()).toEqual(UNDER_THE_LOWEST_RULE);
  });
  // The coordinator's change 1 (39557): a frame with no rule row is refused, which costs a recipe frame nothing only if every
  // input box draws its rules. No pane per recipe case is recorded in the tree; every recorded input-box pane is, across
  // 2.1.29x and 2.1.300 (drafts, tall and capped boxes, stashes, chips, placeholders, asks): each has a rule row.
  it('every recorded input-box pane in the tree has a rule row: the 61 2.1.300 panes and the 29 of the panes\' box folder', () => {
    const boxDir = path.join(dir, 'box');
    const boxFiles = readdirSync(boxDir).filter((f) => f.endsWith('.ansi'));
    expect(boxFiles).toHaveLength(29);
    const unruled = [...files.map((f) => path.join(dir, f)), ...boxFiles.map((f) => path.join(boxDir, f))]
      .filter((f) => !readFileSync(f, 'utf8').split('\n').some((l) => isRuleRow(l.replace(/\x1b\[[0-9;:?]*[a-zA-Z]/g, ''))));
    expect(unruled).toEqual([]);
  });
  it('every recorded pane of the box folder, as the recipe meets it at its real size, reduces on both hosts (review 4086, F-H)', () => {
    // Each is reduced with the status row in place, at the pane's own width and height, so every rule runs as on a real
    // frame; any that does not reduce is named with its word. One limit, pinned: the third stash pane's notice row also
    // carries a path, so the path rule replaces the whole row and the notice is not in the stored frame.
    const boxDir = path.join(dir, 'box');
    const missed: string[] = [];
    const pathRows: string[] = [];
    for (const f of readdirSync(boxDir).filter((n) => n.endsWith('.ansi'))) {
      const recorded = readFileSync(path.join(boxDir, f), 'utf8');
      const pane = realPane(recorded);
      const r = reduceFrame(asTheRecipeMeetsIt(recorded), pane, [], [], NONE);
      if (r.kind !== 'reduced') { missed.push(`${f}: ${r.refusal}`); continue; }
      const c = checkReducedFrame(r.text, pane, [], NONE);
      if (!c.ok) missed.push(`${f}: the server's check, ${c.refusal}`);
      if (r.replaced.path > 0) pathRows.push(f);
    }
    expect(missed).toEqual([]);
    expect(pathRows).toContain('stash-after-cs.ansi');
  });
  it('the third stash pane: the row the path rule replaces is the stash notice row, and the notice is not in the stored text (review 4109, F8b)', () => {
    const recorded = readFileSync(path.join(dir, 'box', 'stash-after-cs.ansi'), 'utf8');
    const pane = realPane(recorded);
    const text = asTheRecipeMeetsIt(recorded);
    const r = reduceFrame(text, pane, [], [], NONE);
    if (r.kind !== 'reduced') throw new Error(`refused: ${r.refusal}`);
    const before = text.split('\n');
    const after = r.text.split('\n');
    const notice = before.findIndex((l) => plainOf(l).includes('› stashed'));
    expect(notice).toBeGreaterThan(0);
    // The one path row is the notice row (it shares its row with the tmux hint's `~/.tmux.conf`), replaced by the token.
    expect(r.replaced.path).toBe(1);
    const changed = before.map((l, i) => (after[i] !== l ? i : -1)).filter((i) => i >= 0);
    expect(changed).toContain(notice);
    expect(after[notice]!.trim()).toBe(FRAMES_REPLACED.cwd);
    expect(r.text).not.toContain('stashed');
  });
  it('the full-width rule has a candidate row in the recorded frames at their real sizes, at least in the six where it had one before wave 195 (review 4109, F8a)', () => {
    // A candidate row is one the rule reads as run to the edge (or to a straddle), with a row under it. Counted by frame
    // over the 61 2.1.300 panes and the box folder's, as the recipe meets them, so a size where the rule cannot fire is noticed.
    const all = [...files.map((f) => path.join(dir, f)), ...readdirSync(path.join(dir, 'box')).filter((f) => f.endsWith('.ansi')).map((f) => path.join(dir, 'box', f))];
    const withCandidate: string[] = [];
    for (const f of all) {
      const recorded = readFileSync(f, 'utf8');
      const pane = realPane(recorded);
      const plains = asTheRecipeMeetsIt(recorded).split('\n').map(plainOf);
      if (plains.some((p, i) => i + 1 < plains.length && runsToTheEdge(p, plains[i + 1]!, pane))) withCandidate.push(path.basename(f));
    }
    expect(all).toHaveLength(90);
    const BEFORE = [
      'cc300-ask-freetext-1000.txt', 'cc300-ask-review-4q-100col.txt', 'cc300-ask-wrapped-question-focused.txt', 'cc300-ask-wrapped-question.txt',
      'box-taller-than-capture.ansi', 'stash-held-during-turn.ansi',
    ];
    expect(withCandidate).toEqual(expect.arrayContaining(BEFORE));
    expect(withCandidate).toHaveLength(6);
  });
  it('the frame size of a recorded pane is measured as the reader measures it', () => {
    expect(frameSize(readFileSync(path.join(dir, files[0]!), 'utf8')).rows).toBeGreaterThan(0);
  });
});
