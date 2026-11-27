// X2 P6.1 Step 0b2: the differential fuzz that is the block cutter's acceptance bar (the plan's Results, Wave P1, "The
// differential fuzz"): seed 20261120, the FULL mix (top-level fences at columns 0 to 3, well-formed list and quote fences
// shorter than a part, list-ended fences, unclosed fences, container fences longer than a part, indented code, setext
// headings), `maxBytes` 60 to 800. The oracle is `mdast-util-from-markdown`'s parse of the whole document: a part boundary
// strictly inside a ROOT-level fenced code node, in a part that adds no close line, is a violation. The line cutter's number on
// the same documents is counted and reported, not asserted (it was 35 159 on the 8 000 of the recorded run). The library judge
// of `mdPartsJudge.ts` (the library's own parse held against each part: no text shown as code, no code shown as text) runs on
// the same documents and is reported too.
//
// Every part also fits and the parts cover the text (the cutters' own invariants), and the cut fed window by window is the
// one-shot cut on the same blocks (the first documents of the run).
//
// `MD_PARTS_FUZZ_DOCS` sets the number of documents: 2 000 by default, and 8 000 is the recorded run.
import { fromMarkdown } from 'mdast-util-from-markdown';
import { describe, expect, it } from 'vitest';
import { utf8Bytes } from '../../shared/utf8';
import { collectMdBlocks, MarkdownCutter, partText, splitMarkdownParts, splitMarkdownPartsAt, type MdPart } from '../src/docs/range/mdParts';
import { askLibrary, blocksOf, judgeViolations } from './mdPartsJudge';

const SEED = 20261120;
const DOCS = Number(process.env.MD_PARTS_FUZZ_DOCS ?? 2000);
/** The library judge's violations on the recorded runs, by number of documents (a ratchet: a worse cutter reds; it may only go down). */
const JUDGE_RECORDED = new Map<number, number>([[2000, 10], [8000, 36]]);

/** mulberry32: a small seeded PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'lorem', 'ipsum', 'dolor', 'amet', 'one', 'two', 'x', 'yy', 'zzz', 'data', 'item'];

/** One random document of the full mix, for windows of `max` bytes. */
function document(rnd: () => number, max: number): string {
  const int = (lo: number, hi: number): number => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)]!;
  const words = (n: number): string => Array.from({ length: n }, () => pick(WORDS)).join(' ');
  const codeLine = (long: boolean): string => {
    const r = rnd();
    if (r < 0.06) return '# not a heading';
    if (r < 0.12) return '- list-like';
    if (r < 0.16) return '```';
    if (r < 0.2) return '~~~';
    if (r < 0.24) return '    indented';
    if (r < 0.28) return '> quote-like';
    if (r < 0.32) return '';
    return long && rnd() < 0.3 ? 'q'.repeat(int(100, 400)) : words(int(1, 6));
  };
  // A fence's body lines: `n` lines, joined with `prefix` in front of each.
  const body = (n: number, prefix: string, long: boolean): string => Array.from({ length: n }, () => (prefix + codeLine(long)).trimEnd() + '\n').join('');
  const mark = (): string => (rnd() < 0.7 ? '`' : '~').repeat(int(3, 5));
  const info = (m: string): string => pick(['', '', 'js', 'ts', 'json title="x"', m[0] === '`' ? 'a-b' : 'x y']);
  // Fence lines that a part holds whole: a few short lines (about a third of a part).
  const shortLines = (): number => Math.max(1, Math.min(6, Math.floor(max / 40)));
  const longLines = (): number => Math.ceil(max / 8) + int(2, 20);

  const blocks: (() => string)[] = [
    () => words(int(2, 12)) + (rnd() < 0.4 ? '\n' + words(int(2, 10)) : '') + '\n', // a paragraph, maybe with a lazy line
    () => '#'.repeat(int(1, 3)) + ' ' + words(int(1, 5)) + '\n',
    () => words(int(1, 4)) + '\n' + pick(['===', '---', '------']) + '\n', // setext heading
    () => '\n'.repeat(int(1, 2)),
    () => { // a top-level fence at columns 0 to 3
      const m = mark();
      const ind = ' '.repeat(int(0, 3));
      const open = ind + m + info(m) + '\n';
      const closer = rnd() < 0.85 ? ind.slice(0, int(0, ind.length)) + m + (rnd() < 0.2 ? m.slice(0, 1).repeat(int(0, 2)) : '') + '\n' : '';
      return open + body(int(0, 30), '', true) + closer;
    },
    () => { // a list item that holds a short fence, well-formed
      const m = mark();
      return pick(['- ', '* ', '1. ']) + words(2) + '\n  ' + m + 'js\n' + body(int(1, shortLines()), '  ', false) + '  ' + m + '\n';
    },
    () => { // a quote that holds a short fence, well-formed
      const m = mark();
      return '> ' + words(2) + '\n> ' + m + 'sh\n' + body(int(1, shortLines()), '> ', false) + '> ' + m + '\n';
    },
    () => { // a list-ended fence: the item ends before the fence's closer
      const m = mark();
      return '- ' + words(1) + '\n  ' + m + 'js\n' + body(int(1, 3), '  ', false) + pick(['- ' + words(1) + '\n', words(2) + '\n', '\n' + words(2) + '\n']);
    },
    () => { // a container fence longer than a part, on the item's marker line or a later line, or in a quote
      const m = mark();
      const kind = int(0, 2);
      if (kind === 0) return '- ' + m + 'json\n' + body(longLines(), '  ', false) + '  ' + m + '\n';
      if (kind === 1) return '- ' + words(1) + '\n  ' + m + 'sh\n' + body(longLines(), '  ', false) + '  ' + m + '\n';
      return '> ' + m + 'py\n' + body(longLines(), '> ', false) + '> ' + m + '\n';
    },
    () => { const m = mark(); return m + info(m) + '\n' + body(int(0, 12), '', true); }, // an unclosed fence
    () => Array.from({ length: int(1, 4) }, () => '    ' + words(int(1, 5)) + '\n').join(''), // indented code (after a blank line: see below)
    () => Array.from({ length: int(2, 9) }, (_, i) => (rnd() < 0.5 ? '- ' : `${i + 1}. `) + words(int(1, 4)) + '\n').join(''),
  ];
  const n = int(1, 25);
  let doc = '';
  for (let i = 0; i < n; i += 1) {
    const kind = int(0, blocks.length - 1);
    let piece = blocks[kind]!();
    // Indented code only follows a blank line, as it must to be code.
    if (kind === 10 && !doc.endsWith('\n\n')) piece = '\n' + piece;
    doc += piece;
    if (rnd() < 0.5) doc += '\n';
  }
  return doc;
}

/** The offsets of each line start of `s`. */
function lineStarts(s: string): number[] {
  const a = [0];
  const re = /\r\n|\r|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) a.push(m.index + m[0].length);
  return a;
}

/** The `[from, to)` offsets of each ROOT-level fenced code node of `doc`, by `mdast-util-from-markdown`. */
function rootFences(doc: string): { from: number; to: number }[] {
  const ls = lineStarts(doc);
  const out: { from: number; to: number }[] = [];
  for (const n of fromMarkdown(doc).children) {
    if (n.type !== 'code' || n.position === undefined) continue;
    const from = ls[n.position.start.line - 1]!;
    if (!/^ {0,3}(`{3,}|~{3,})/.test(doc.slice(from, from + 8))) continue; // indented code
    out.push({ from, to: n.position.end.offset! });
  }
  return out;
}

/** Why `parts` do not fit and cover `doc` in parts of at most `max` bytes, or null when they do. */
function fitAndCover(doc: string, parts: readonly MdPart[], max: number): string | null {
  if (parts.length === 0 || parts[0]!.start !== 0 || parts[parts.length - 1]!.end !== doc.length) return 'the parts do not cover the text';
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!;
    if (p.end <= p.start) return `part ${i} is empty`;
    if (i > 0 && p.start !== parts[i - 1]!.end) return `part ${i} does not start where part ${i - 1} ended`;
    if (utf8Bytes(partText(doc, p)) > max) return `part ${i} is over ${max} bytes`;
  }
  return null;
}

/** The violations of `parts` by the oracle: a boundary strictly inside a root fence, in a part that adds no close. */
function oracleViolations(fences: readonly { from: number; to: number }[], parts: readonly MdPart[]): number {
  let n = 0;
  for (const p of parts.slice(0, -1)) {
    if (p.close !== null) continue;
    if (fences.some((f) => p.end > f.from && p.end < f.to)) n += 1;
  }
  return n;
}

describe('the differential fuzz of the Markdown parts\' cutters', { timeout: 1800000 }, () => {
  it('md parts fuzz: the block cutter has no cut inside a root-level fenced block without its close, on the full mix', async () => {
    const rnd = mulberry32(SEED);
    let multi = 0;
    let newViolations = 0;
    let newDocs = 0;
    let lineViolations = 0;
    let lineDocs = 0;
    let judgeCount = 0;
    let judgeDocs = 0;
    let lineJudgeCount = 0;
    let lineJudgeDocs = 0;
    const judgeSamples: string[] = [];
    const started = Date.now();
    for (let i = 0; i < DOCS; i += 1) {
      const max = 60 + Math.floor(rnd() * 741);
      const doc = document(rnd, max);
      const fences = rootFences(doc);
      const { blocks, tailFrom } = await blocksOf(doc);
      const parts = splitMarkdownPartsAt(doc, max, blocks, tailFrom).parts;
      const line = splitMarkdownParts(doc, max).parts;
      if (parts.length > 1) multi += 1;
      // Fit and cover, for both cutters.
      for (const ps of [parts, line]) {
        const bad = fitAndCover(doc, ps, max);
        if (bad !== null) expect.soft(bad, JSON.stringify({ max, doc })).toBe('');
      }
      const v = oracleViolations(fences, parts);
      newViolations += v;
      if (v > 0) { newDocs += 1; if (newDocs <= 3) expect.soft(JSON.stringify({ max, doc }), 'a violation of the block cutter').toBe(''); }
      const lv = oracleViolations(fences, line);
      lineViolations += lv;
      if (lv > 0) lineDocs += 1;
      const j = judgeViolations(doc, parts);
      judgeCount += j.length;
      if (j.length > 0) { judgeDocs += 1; if (judgeSamples.length < 5) judgeSamples.push(JSON.stringify({ max, doc, first: j[0] })); }
      const lj = judgeViolations(doc, line);
      lineJudgeCount += lj.length;
      if (lj.length > 0) lineJudgeDocs += 1;
    }
    const seconds = Math.round((Date.now() - started) / 1000);
    const report = `md parts fuzz: ${DOCS} documents, ${multi} of more than one part, ${seconds} s. Block cutter: ${newViolations} oracle violations `
      + `(${newDocs} documents). Line cutter (P1): ${lineViolations} (${lineDocs} documents). Library judge on the block cutter: ${judgeCount} (${judgeDocs} documents); `
      + `on the line cutter: ${lineJudgeCount} (${lineJudgeDocs} documents).`;
    console.log(report);
    for (const s of judgeSamples) console.log('md parts fuzz: library judge sample: ' + s);
    expect(newViolations, report).toBe(0);
    // The library judge's count is reported above and is not zero: 36 lines in 27 of the 8 000 documents (the line cutter's:
    // 169 842 in 4 262). What is left is mostly one class: a paragraph, or the text of a list item or quote, longer than a part,
    // with a line indented four columns or more inside it (an indented continuation line), which the line cutter's fallback cuts
    // before, so the part that starts there reads it as indented code (residual 5); and a few list items that hold two or more
    // fences and a long text, where the fallback cuts inside a container fence (residual 2). So it is bounded, not asserted zero:
    // a worse cutter reds.
    const recorded = JUDGE_RECORDED.get(DOCS);
    if (recorded !== undefined) expect(judgeCount, report).toBeLessThanOrEqual(recorded);
  });

  it('md parts fuzz: the cut fed window by window is the one-shot cut on the same blocks', async () => {
    const rnd = mulberry32(SEED);
    let early = 0;
    for (let i = 0; i < Math.min(DOCS, 600); i += 1) {
      const max = 60 + Math.floor(rnd() * 741);
      const doc = document(rnd, max);
      const cutter = new MarkdownCutter(doc, max);
      const fed: MdPart[] = [];
      const got = await collectMdBlocks(doc, askLibrary, new AbortController().signal, {
        windowBytes: 200 + (i % 7) * 100,
        onBlocks: (blocks, frontier) => { for (const p of cutter.feed(blocks, frontier)) fed.push(p); },
      });
      early += fed.length;
      const incremental = [...fed, ...cutter.finish(got.tailFrom)];
      expect(incremental, JSON.stringify({ max, doc })).toEqual(splitMarkdownPartsAt(doc, max, got.blocks, got.tailFrom).parts);
    }
    expect(early, 'some parts were final before the end of the read').toBeGreaterThan(0);
  });
});
