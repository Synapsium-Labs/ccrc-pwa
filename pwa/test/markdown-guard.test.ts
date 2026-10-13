// The Markdown pre-scan and the UTF-8 byte count (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and
// section 4.15's M4.P1, M4.P2, M4.P3). `prescanMarkdown` refuses a line with more than 32 container markers (on every
// line, fenced or not; a tab advances to the next multiple of 4 columns) or a run of more than 64 `*` or `_` (fenced
// blocks skipped for this check only), and reports the FIRST refusing line (1-based) with that line's whole count.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prescanMarkdown, prescanWithin, utf8ByteLength } from '../src/lib/markdownGuard';
import { MD_MAX_CONTAINER_DEPTH, MD_MAX_DELIMITER_RUN } from '../src/lib/markdownLimits';

const deepQuote = (n: number): string => '> '.repeat(n) + 'x';
const ok = { ok: true };

describe('M4.P1: container depth', () => {
  it("'>'.repeat(10000) + ' x' is refused on line 1 with its whole depth", () => {
    expect(prescanMarkdown('>'.repeat(10000) + ' x')).toEqual({
      ok: false, why: 'container-depth', line: 1, value: 10000,
    });
  });

  it('32 levels pass and 33 are refused', () => {
    expect(prescanMarkdown(deepQuote(32))).toEqual(ok);
    expect(prescanMarkdown(deepQuote(33))).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
  });

  it.each([
    ['-', '- '], ['+', '+ '], ['*', '* '], ['1.', '1. '], ['9)', '9) '], ['- then a tab', '-\t'], ['123456789.', '123456789. '],
  ])('the list marker %s counts as a container', (_label, marker) => {
    expect(prescanMarkdown(marker.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
  });

  it.each([
    ['1.x (no space after the marker)', '1.x'],
    ['a ten-digit marker', '1234567890. x'],
    ['a marker at the end of the line', '-'],
    ['a marker followed by text', '-x'],
  ])('%s is not a container', (_label, tail) => {
    expect(prescanMarkdown('> '.repeat(32) + tail)).toEqual(ok);
  });

  it('skips up to three spaces before a marker, never four', () => {
    expect(prescanMarkdown('   > '.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
    expect(prescanMarkdown('> ' + '    >'.repeat(40))).toEqual(ok);
  });

  it('numbers lines across LF, CRLF and CR, and reports the first refusing line', () => {
    expect(prescanMarkdown(`a\nb\n${deepQuote(40)}\n${deepQuote(50)}`)).toEqual({
      ok: false, why: 'container-depth', line: 3, value: 40,
    });
    expect(prescanMarkdown(`a\r\nb\r\n${deepQuote(40)}`)).toMatchObject({ line: 3 });
    expect(prescanMarkdown(`a\rb\r${deepQuote(40)}`)).toMatchObject({ line: 3 });
    expect(prescanMarkdown(`a\r\n\rb\n${deepQuote(40)}`)).toMatchObject({ line: 4 });
  });
});

describe('M4.P2: delimiter runs', () => {
  it.each(['*', '_'])('a 4 096-run of %s is refused with its length', (ch) => {
    expect(prescanMarkdown(ch.repeat(4096))).toEqual({ ok: false, why: 'delimiter-run', line: 1, value: 4096 });
  });

  it('a 64-run passes and a 65-run is refused', () => {
    expect(prescanMarkdown(`a${'*'.repeat(64)}a`)).toEqual(ok);
    expect(prescanMarkdown(`a\nb${'_'.repeat(65)}b`)).toEqual({ ok: false, why: 'delimiter-run', line: 2, value: 65 });
  });

  it('a run is one character repeated: alternating marks never make one', () => {
    expect(prescanMarkdown('*_'.repeat(4096))).toEqual(ok);
  });
});

describe('fenced blocks are skipped for the delimiter-run check only', () => {
  const run = '*'.repeat(100);
  const refusedRun = (line: number): unknown => ({ ok: false, why: 'delimiter-run', line, value: 100 });

  it('a backtick fence and a longer tilde fence hide long runs', () => {
    expect(prescanMarkdown(`\`\`\`\n${run}\n\`\`\`\nafter`)).toEqual(ok);
    expect(prescanMarkdown(`~~~~ text\n${run}\n~~~~\nafter`)).toEqual(ok);
    expect(prescanMarkdown(`   \`\`\`\n${run}\n   \`\`\``)).toEqual(ok);
  });

  it('after the closing fence, lines are scanned again', () => {
    expect(prescanMarkdown(`\`\`\`\nx\n\`\`\`\n${run}`)).toEqual(refusedRun(4));
  });

  it('an unclosed fence runs to the end', () => {
    expect(prescanMarkdown(`\`\`\`\n${run}\n${run}`)).toEqual(ok);
  });

  it('a shorter fence, the other character, or a fence with text after it does not close', () => {
    expect(prescanMarkdown(`\`\`\`\`\n\`\`\`\n${run}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n~~~\n${run}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n\`\`\` js\n${run}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n\`\`\`  \t\n${run}`)).toEqual(refusedRun(3));
  });

  it('four leading spaces is not a fence, nor are two marks, nor a backtick fence whose info has a backtick', () => {
    expect(prescanMarkdown(`    \`\`\`\n${run}`)).toEqual(refusedRun(2));
    expect(prescanMarkdown(`\`\`\n${run}`)).toEqual(refusedRun(2));
    expect(prescanMarkdown(`\`\`\`a\`b\n${run}`)).toEqual(refusedRun(2));
    expect(prescanMarkdown(`~~~a\`b\n${run}`)).toEqual(ok);
  });
});

// The review of Task 3 measured three ways to hide a deep line from the first pre-scan. Each input below reached the
// parser and threw a RangeError there; each is refused now. (Indentation-continued nesting, the review's third
// shape, is not covered by the pre-scan: parseMarkdown's try/catch, MD_MAX_TREE_DEPTH and the worker budget bound it.)
describe('W4-X1: tabs are column-aware', () => {
  it("'>' then a tab, repeated, counts every marker (the review's input (a))", () => {
    expect(prescanMarkdown('>\t'.repeat(10000) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 10000 });
    expect(prescanMarkdown('>\t'.repeat(32) + 'x')).toEqual(ok);
    expect(prescanMarkdown('>\t'.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
  });

  it('a tab after a marker is part of its indentation: it can lead the next marker, never make four columns', () => {
    // '>' at column 0, a space, a tab to column 4: the next '>' sits at column 4 with 0 columns of indentation.
    expect(prescanMarkdown('> \t'.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
    // '>' then two tabs: the second tab alone is 4 columns, so what follows is indented code, not a marker.
    expect(prescanMarkdown('>\t\t'.repeat(40) + 'x')).toEqual(ok);
    expect(prescanMarkdown('> \t\t>'.repeat(40))).toEqual(ok);
    // The tab after '>' fills columns 1-3: one is the optional space, two carry over, and two more spaces make 4.
    expect(prescanMarkdown('>\t  >'.repeat(40))).toEqual(ok);
    expect(prescanMarkdown('>\t '.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
  });

  it('a tab after a list marker advances to the next multiple of 4, and 5 or more columns of padding is code', () => {
    expect(prescanMarkdown('-\t'.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
    expect(prescanMarkdown('1.\t'.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
    expect(prescanMarkdown('-    '.repeat(33) + 'x')).toEqual({ ok: false, why: 'container-depth', line: 1, value: 33 });
    expect(prescanMarkdown('-     '.repeat(40) + 'x')).toEqual(ok);
    expect(prescanMarkdown('-\t\t'.repeat(40) + 'x')).toEqual(ok);
  });

  it('an ordinary tab-indented list passes', () => {
    const list = '- one\n\t- two\n\t\t- three\n\t\t\t- four\n- five\n>\tquoted\n1.\tordered\n';
    expect(prescanMarkdown(list)).toEqual(ok);
  });
});

describe('W4-X1: container depth is counted inside fenced blocks', () => {
  const deepLine = '>'.repeat(10000) + ' x';
  const refused = { ok: false, why: 'container-depth', value: 10000 };

  it.each([
    ['a fence opened inside a list item (the parser closes it with the item)', `- a\n  \`\`\`\n${deepLine}`, 3],
    ['an ordered item whose second fence line is indented past the item', `1. a\n   \`\`\`\n      \`\`\`\n${deepLine}`, 4],
    ['a fence after an HTML block start', `<div>\n\`\`\`\n\n${deepLine}`, 4],
    ['a plain unclosed fence', `\`\`\`\n${deepLine}`, 2],
    ['a tilde fence', `~~~\n${deepLine}\n~~~`, 2],
  ])('%s is refused on its deep line', (_label, src, line) => {
    expect(prescanMarkdown(src)).toEqual({ ...refused, line });
  });

  it('a fenced block inside a list item, with ordinary code in it, passes', () => {
    const doc = '- step one\n\n  ```sh\n  $ ls | wc -l\n  > prompt\n  ```\n\n- step two\n  ```\n  * * *\n  ```\n';
    expect(prescanMarkdown(doc)).toEqual(ok);
  });

  it('the delimiter-run skip inside a fence is unchanged', () => {
    expect(prescanMarkdown('- a\n  ```\n' + '*'.repeat(100) + '\n  ```')).toEqual(ok);
  });
});

describe('utf8ByteLength counts what TextEncoder writes', () => {
  const ch = (...codes: number[]): string => String.fromCharCode(...codes);
  it.each([
    ['empty', ''],
    ['ASCII', 'plain text, 123'],
    ['two-byte', String.fromCodePoint(0xe9, 0x3b1)],
    ['three-byte', String.fromCodePoint(0x20ac, 0x2318)],
    ['four-byte', String.fromCodePoint(0x1f600, 0x10ffff)],
    ['a lone high surrogate', ch(0x61, 0xd800, 0x62)],
    ['a lone low surrogate', ch(0xdc00)],
    ['a high surrogate at the end', ch(0x61, 0xd83d)],
    ['a reversed pair', ch(0xde00, 0xd83d)],
    ['mixed', `a${String.fromCodePoint(0xe9, 0x20ac, 0x1f600)}${ch(0xd800)}z`.repeat(50)],
  ])('%s', (_label, s) => {
    expect(utf8ByteLength(s)).toBe(new TextEncoder().encode(s).length);
  });
});

// M4.P3: no false positives on this repo's own largest documents. A directory walk (no git), every `.md` under
// docs/superpowers, sorted by size descending and then by path; the set moves as programmes merge, so the vacuity
// case measures it each run.
const DOCS = path.join(import.meta.dirname, '..', '..', 'docs', 'superpowers');

function markdownFiles(dir: string): { file: string; size: number }[] {
  const out: { file: string; size: number }[] = [];
  const dirs = [dir];
  while (dirs.length > 0) {
    const d = dirs.pop()!;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) dirs.push(p);
      else if (e.isFile() && e.name.endsWith('.md')) out.push({ file: p, size: statSync(p).size });
    }
  }
  return out.sort((a, b) => b.size - a.size || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

const LARGEST = markdownFiles(DOCS).slice(0, 10).map(({ file }) => ({
  name: path.relative(DOCS, file).split(path.sep).join('/'),
  text: readFileSync(file, 'utf8'),
}));

describe('M4.P3: the ten largest docs under docs/superpowers pre-scan ok', () => {
  it('there are ten', () => {
    expect(LARGEST).toHaveLength(10);
  });

  it.each(LARGEST)('$name', ({ text }) => {
    expect(prescanMarkdown(text)).toEqual(ok);
  });

  // Not vacuous: the set really nests and really runs, so a limit lowered to the set's own maximum minus one reds
  // the cases above. Measured at planning: the deepest line holds 2 containers, the longest run is 3. If either
  // fails, the set has changed shape: stop and ask the coordinator, never lower the bar here.
  it('the set reaches a container depth of 2 and a delimiter run of 3', () => {
    const refusedAt = (containerDepth: number, delimiterRun: number): number =>
      LARGEST.filter(({ text }) => !prescanWithin(text, { containerDepth, delimiterRun }).ok).length;
    expect(refusedAt(1, MD_MAX_DELIMITER_RUN)).toBeGreaterThan(0);
    expect(refusedAt(MD_MAX_CONTAINER_DEPTH, 2)).toBeGreaterThan(0);
  });
});

// A GFM footnote-definition label (`[^label]:`) at a container position is a container: the parser nests what follows
// it, so a `>` or list-marker chain after it is as deep as the same chain at the start of the line. Both inputs below
// are about 4 KiB, passed the pre-scan, and made the synchronous chat render throw a RangeError.
describe('T11 review 2-1: a footnote-definition label counts as a container', () => {
  const refused = (line: number, value: number): unknown => ({ ok: false, why: 'container-depth', line, value });

  it("'>' repeated after a footnote label is refused with the label and every marker counted", () => {
    expect(prescanMarkdown('x[^a]\n\n[^a]: ' + '>'.repeat(4070) + ' y')).toEqual(refused(3, 4071));
    expect(prescanMarkdown('[^a]: ' + '>'.repeat(4080))).toEqual(refused(1, 4081));
  });

  it("a list-marker chain after a footnote label is refused", () => {
    expect(prescanMarkdown('x[^a]\n\n[^a]: ' + '- '.repeat(2030) + 'y')).toEqual(refused(3, 2031));
  });

  it('a label counts as one level, at the edge, after a quote or a list marker, and when it follows a label', () => {
    expect(prescanMarkdown('[^a]: ' + '> '.repeat(31) + 'x')).toEqual(ok);
    expect(prescanMarkdown('[^a]: ' + '> '.repeat(32) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('> [^a]: ' + '> '.repeat(31) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('- [^a]: ' + '> '.repeat(31) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('[^a]: '.repeat(33) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('[^a]:'.repeat(33) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('[^a]:\t'.repeat(33) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('   [^a]: ' + '> '.repeat(32) + 'x')).toEqual(refused(1, 33));
  });

  it('an ordinary footnote definition, and one holding a short list, pass', () => {
    expect(prescanMarkdown('text[^1] and more[^note].\n\n[^1]: The first note.\n[^note]: A note.\n')).toEqual(ok);
    expect(prescanMarkdown('x[^a]\n\n[^a]: Intro\n\n    - one\n    - two\n      - nested\n\n    > a quote\n')).toEqual(ok);
    expect(prescanMarkdown('[^a]: - one\n')).toEqual(ok);
  });

  it.each([
    ['no caret', '[a]: '],
    ['an empty label', '[^]: '],
    ['a space in the label', '[^a b]: '],
    ['a tab in the label', '[^a\tb]: '],
    ['a bracket in the label', '[^a[b]: '],
    ['no closing bracket', '[^ab: '],
    ['no colon', '[^a] '],
    ['four columns of indentation', '    [^a]: '],
    ['a label of 1 000 characters', `[^${'a'.repeat(1000)}]: `],
  ])('%s is not a footnote definition', (_label, head) => {
    expect(prescanMarkdown(head + '> '.repeat(32) + 'x')).toEqual(ok);
  });

  it('a label of 999 characters is one, and so is one with escaped brackets', () => {
    expect(prescanMarkdown(`[^${'a'.repeat(999)}]: ` + '> '.repeat(32) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('[^a\\]b]: ' + '> '.repeat(32) + 'x')).toEqual(refused(1, 33));
    expect(prescanMarkdown('[^a\\[b]: ' + '> '.repeat(32) + 'x')).toEqual(refused(1, 33));
  });
});
