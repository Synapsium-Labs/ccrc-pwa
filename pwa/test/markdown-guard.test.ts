// The Markdown pre-scan and the UTF-8 byte count (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and
// section 4.15's M4.P1, M4.P2, M4.P3). `prescanMarkdown` refuses a line with more than 32 container markers or a run
// of more than 64 `*` or `_`, skips fenced blocks for both checks, and reports the FIRST refusing line (1-based)
// with that line's whole count.
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

describe('fenced blocks are skipped for both checks', () => {
  const deep = '>'.repeat(100);
  const run = '*'.repeat(100);

  it('a backtick fence and a longer tilde fence hide deep lines and long runs', () => {
    expect(prescanMarkdown(`\`\`\`\n${deep}\n${run}\n\`\`\`\nafter`)).toEqual(ok);
    expect(prescanMarkdown(`~~~~ text\n${deep}\n~~~~\nafter`)).toEqual(ok);
    expect(prescanMarkdown(`   \`\`\`\n${deep}\n   \`\`\``)).toEqual(ok);
  });

  it('after the closing fence, lines are scanned again', () => {
    expect(prescanMarkdown(`\`\`\`\nx\n\`\`\`\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 4, value: 100 });
  });

  it('an unclosed fence runs to the end', () => {
    expect(prescanMarkdown(`\`\`\`\n${deep}\n${run}\n${deep}`)).toEqual(ok);
  });

  it('a shorter fence, the other character, or a fence with text after it does not close', () => {
    expect(prescanMarkdown(`\`\`\`\`\n\`\`\`\n${deep}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n~~~\n${deep}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n\`\`\` js\n${deep}`)).toEqual(ok);
    expect(prescanMarkdown(`\`\`\`\n\`\`\`  \t\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 3, value: 100 });
  });

  it('four leading spaces is not a fence, nor are two marks, nor a backtick fence whose info has a backtick', () => {
    expect(prescanMarkdown(`    \`\`\`\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 2, value: 100 });
    expect(prescanMarkdown(`\`\`\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 2, value: 100 });
    expect(prescanMarkdown(`\`\`\`a\`b\n${deep}`)).toEqual({ ok: false, why: 'container-depth', line: 2, value: 100 });
    expect(prescanMarkdown(`~~~a\`b\n${deep}`)).toEqual(ok);
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
