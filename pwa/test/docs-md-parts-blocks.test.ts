// X2 P6.1 Step 0b2: Markdown parts cut at the library's own block boundaries (`splitMarkdownPartsAt` and `collectMdBlocks`,
// `pwa/src/docs/range/mdParts.ts`). The blocks come from the shared Markdown library through the worker's blocks job
// (`answerRenderJob` with `blocks: true`), and the judge (`mdPartsJudge.ts`) holds the library's parse of the whole document
// against each part: no part shows text as code or code as text. The nine residual classes of P1's line cutter (Results,
// Wave P1, "The cutter's residuals") are cases here, each with its recorded input at its recorded `maxBytes`.
import { describe, expect, it } from 'vitest';
import { utf8Bytes } from '../../shared/utf8';
import {
  blockWindow, collectMdBlocks, cutMarkdownText, foldBlockWindow, MarkdownCutter, partText, splitMarkdownParts, splitMarkdownPartsAt,
  type MdPart, type TextBlock,
} from '../src/docs/range/mdParts';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { READER_BLOCKS_MAX_BYTES } from '../src/lib/readerLimits';
import { answerRenderJob, type ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import type { MdBlock } from '../src/lib/renderTree';
import { askLibrary, blocksOf, judgeViolations, lineStartsOf } from './mdPartsJudge';

const GATE = DOCS_RENDER_GATE_BYTES;

/** Every invariant a split must hold: the parts cover the text in order with no gap or overlap, each part's text (its reopen
 *  and close counted) is at most `max` bytes, and a part that is not the first starts where the last ended. */
function checkCover(text: string, parts: readonly MdPart[], max: number): void {
  expect(parts.length).toBeGreaterThan(0);
  expect(parts[0]!.start).toBe(0);
  expect(parts.at(-1)!.end).toBe(text.length);
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i]!;
    expect(p.end, `part ${i} is not empty`).toBeGreaterThan(p.start);
    if (i > 0) expect(p.start, `part ${i} starts where part ${i - 1} ended`).toBe(parts[i - 1]!.end);
    expect(utf8Bytes(partText(text, p)), `part ${i} is at most ${max} bytes`).toBeLessThanOrEqual(max);
  }
}

/** The new cutter on `text`: the blocks from the library, then the cut. */
async function cut(text: string, max: number): Promise<MdPart[]> {
  const { blocks, tailFrom } = await blocksOf(text);
  expect(tailFrom, 'the library read the whole text').toBeNull();
  return splitMarkdownPartsAt(text, max, blocks, tailFrom).parts;
}

/** A cut that fits, covers and has no violation by the judge. */
async function cutsRight(text: string, max: number): Promise<MdPart[]> {
  const parts = await cut(text, max);
  checkCover(text, parts, max);
  expect(judgeViolations(text, parts), `max ${max}`).toEqual([]);
  return parts;
}

const X40 = 'x'.repeat(40);
const Y40 = 'y'.repeat(40);

// The cases render through the library, so a loaded box may need more than vitest's default five seconds.
describe('splitMarkdownPartsAt: the nine residual classes of the line cutter, judged by the library\'s parse', { timeout: 60000 }, () => {
  // Class 1: a fence that its list item ended, then a later fence at column 0.
  const class1 = [
    { t: '- a\n  ```js\n  x\n- b\n\n' + 'prose para.\n\n'.repeat(5) + '```\n' + 'code line\n'.repeat(200) + '```\n\n' + 'after para.\n\n'.repeat(200), max: 4000 },
    { t: '- item one\n'.repeat(80) + '- item\n  ```js\n' + '  code\n'.repeat(5) + '- next item\n\nThe closing paragraph.\n', max: 900 },
    { t: '    ```\n  ```js\nreal code\n```\n\nprose one\n\nprose two\n\nprose three\n', max: 30 },
  ];
  it('md parts at blocks: residual 1 (a list-ended fence, then a later fence at column 0), its three recorded inputs', async () => {
    for (const { t, max } of class1) await cutsRight(t, max);
  });

  it('md parts at blocks: residual 2 (a zone longer than a whole part: a container fence, a fence with a marker over 64 characters)', async () => {
    await cutsRight('- ```json\n' + '  zzzzzzzzzz\n'.repeat(12) + '  ```\nAfter the list.\n## Next\n', 100);
    const mark = '`'.repeat(70);
    await cutsRight(mark + '\n' + 'code line number\n'.repeat(60) + mark + '\nafter\n', 200);
    await cutsRight('> ```json\n' + '> yyyyyyyyyyyyyyyyyyyy\n'.repeat(60) + '> ```\n\n## Next\n\n' + 'f\n\n'.repeat(200), 300);
  });

  it('md parts at blocks: residual 3 (windows under about 60 bytes), the list-ended fence input at 51, 52, 53 and 54', async () => {
    for (const max of [51, 52, 53, 54]) await cutsRight(class1[0]!.t, max);
  });

  it('md parts at blocks: residual 3 at 11 to 14 bytes: every part fits (a part that small cannot hold a fence\'s two lines, so only the fit is asserted)', async () => {
    for (const max of [11, 12, 13, 14]) {
      const t = class1[0]!.t;
      checkCover(t, await cut(t, max), max);
    }
  });

  it('md parts at blocks: residual 4 (a code-point tail that starts with a fence marker)', async () => {
    const t = '```\n' + 'a'.repeat(1000) + '```\ncode\n```\n\nprose after the fence.\n\nmore prose.\n';
    await cutsRight(t, 509);
  });

  it('md parts at blocks: residual 5 (a cut inside a list item that starts a part with indented text)', async () => {
    const t = '1. first\n\n    para two of the item\n\n'.repeat(60);
    const parts = await cutsRight(t, 200);
    for (const p of parts.slice(1)) expect(t.startsWith('1. first', p.start), 'a part starts at an item').toBe(true);
  });

  it('md parts at blocks: residual 6 (indented fence-looking code, then an indented real fence opener)', async () => {
    await cutsRight('    ```js\n  ```ts\n' + X40 + '\n' + Y40 + '\n```\nafter\n', 80);
    await cutsRight('    ```js\n  ```ts\n' + X40 + '\n- ```md\n' + Y40 + '\n```\nafter\n', 80);
  });

  it('md parts at blocks: residual 7 (an empty list marker, a plain line, then a fence at the marker\'s content column)', async () => {
    await cutsRight('-\nx\n  ```ts\n' + X40 + '\n' + Y40 + '\n```\nafter\n', 80);
  });

  it('md parts at blocks: residual 8 (a thematic break, a tab after a marker, a plain line after a closed fence or a heading of an item), its four inputs', async () => {
    const tail = '  ```ts\n' + X40 + '\n' + Y40 + '\n```\nafter\n';
    await cutsRight('* * *\n' + tail, 80);
    await cutsRight('-\tfoo\n' + tail, 80);
    await cutsRight('- item\n  ```js\n  c\n  ```\ntext\n' + tail, 80);
    await cutsRight('- item\n  # H\nlazy?\n' + tail, 80);
  });

  it('md parts at blocks: residual 9 (an item whose marker is followed only by spaces)', async () => {
    await cutsRight('-   \n  ```ts\n' + X40 + '\n' + Y40 + '\n' + 'z'.repeat(40) + '\n\nend\n', 80);
  });
});

describe('splitMarkdownPartsAt: where a part ends', { timeout: 60000 }, () => {
  /** A text of `n` paragraphs, each `Paragraph k` and a line of filler, and the block starts a part may begin at. */
  const paragraphs = (n: number): string => Array.from({ length: n }, (_, k) => `Paragraph ${k} ${'w'.repeat(30)}\n\n`).join('');

  it('md parts at blocks: a part ends only between top-level blocks while one fits', async () => {
    const t = paragraphs(300);
    const max = 500;
    const { blocks } = await blocksOf(t);
    const starts = new Set(blocks.map((b) => b.start));
    const parts = await cutsRight(t, max);
    expect(parts.length).toBeGreaterThan(10);
    for (const p of parts.slice(1)) expect(starts.has(p.start), `a part starts at a block start (${p.start})`).toBe(true);
    // Greedy: no part could have taken the block after it.
    const sorted = [...starts].sort((a, b) => a - b);
    for (const p of parts.slice(0, -1)) {
      const next = sorted.find((s) => s > p.end);
      if (next !== undefined) expect(utf8Bytes(t.slice(p.start, next)), `the part at ${p.start} is as long as a block boundary allows`).toBeGreaterThan(max);
    }
  });

  it('md parts at blocks: a heading block start is preferred', async () => {
    const t = Array.from({ length: 40 }, (_, k) => `## Section ${k}\n\nFirst paragraph of ${k}.\n\nSecond paragraph of ${k}, a little longer.\n\n`).join('');
    const parts = await cutsRight(t, 300);
    expect(parts.length).toBeGreaterThan(8);
    expect(parts[0]!.continued).toBe(false);
    for (const p of parts.slice(1)) {
      expect(t.startsWith('## Section', p.start), `a part starts at a heading (${JSON.stringify(t.slice(p.start, p.start + 20))})`).toBe(true);
      expect(p.continued).toBe(false);
    }
    // Without a heading that fits the part ends at the latest block, and the next part is continued.
    const flat = paragraphs(100);
    const flatParts = await cutsRight(flat, 400);
    for (const p of flatParts.slice(1)) expect(p.continued).toBe(true);
  });

  it('md parts at blocks: never before a three-dash line', async () => {
    // A thematic break right after each paragraph: a part that began at one, with a `title: x` line and another `---` in it,
    // would read as front matter. Over every window size the greedy cut would land before some of them.
    const t = Array.from({ length: 60 }, (_, k) => `Paragraph ${k} of the text\n\n---\n\nnext ${k}\n\n`).join('');
    const { blocks } = await blocksOf(t);
    const dashes = new Set(blocks.filter((b) => t.startsWith('---', b.start)).map((b) => b.start));
    expect(dashes.size, 'the text has a `---` block after every paragraph').toBe(60);
    for (let max = 60; max <= 200; max += 1) {
      const { parts } = splitMarkdownPartsAt(t, max, blocks, null);
      checkCover(t, parts, max);
      for (const p of parts.slice(1)) expect(dashes.has(p.start), `max ${max}: a part starts at the thematic break at ${p.start}`).toBe(false);
    }
    await cutsRight(t, 90);
  });

  it('md parts at blocks: an oversized list is cut between its items', async () => {
    const t = Array.from({ length: 200 }, (_, k) => `- item ${String(k).padStart(3, '0')} of the list\n`).join('');
    const parts = await cutsRight(t, 500);
    expect(parts.length).toBeGreaterThan(8);
    for (const p of parts.slice(1)) expect(t.startsWith('- item', p.start), `a part starts at an item (${p.start})`).toBe(true);
    for (const p of parts) { expect(p.reopen).toBeNull(); expect(p.close).toBeNull(); }
    // A list with an item that holds text and a fence, in a loose list, is cut between its items too.
    const loose = Array.from({ length: 40 }, (_, k) => `- step ${k}\n\n  more about ${k}\n\n  \`\`\`sh\n  run ${k}\n  \`\`\`\n\n`).join('');
    const lp = await cutsRight(loose, 300);
    expect(lp.length).toBeGreaterThan(4);
    for (const p of lp.slice(1)) expect(loose.startsWith('- step', p.start), `a part starts at an item (${p.start})`).toBe(true);
  });

  it('md parts at blocks: a fence longer than a part is closed and reopened, at the top level and in a list item and a quote', async () => {
    const top = '```ts\n' + 'const x = 1;\n'.repeat(60) + '```\nafter\n';
    const pt = await cutsRight(top, 200);
    expect(pt.length).toBeGreaterThan(3);
    expect(pt[0]!.close).toBe('```\n');
    expect(pt[1]!.reopen).toBe('``` ts\n');
    expect(pt.at(-1)!.close).toBeNull();
    // A fence on a list item's marker line: the opener's own prefix reopens it, the content column closes it.
    const item = '- ```json\n' + '  "k": 1,\n'.repeat(40) + '  ```\nafter\n';
    const pi = await cutsRight(item, 150);
    expect(pi.length).toBeGreaterThan(2);
    expect(pi[0]!.close).toBe('  ```\n');
    expect(pi[1]!.reopen).toBe('- ``` json\n');
    // A fence on a later line of a list item: the item's marker alone, then the opener's own prefix.
    const later = '- item\n  ```sh\n' + '  run it\n'.repeat(40) + '  ```\n- next\n';
    const pl = await cutsRight(later, 120);
    expect(pl.length).toBeGreaterThan(2);
    expect(pl[0]!.close).toBe('  ```\n');
    expect(pl[1]!.reopen).toBe('-\n  ``` sh\n');
    // A fence in a quote: the quote mark stays on both lines.
    const quote = '> ```py\n' + '> x = 1\n'.repeat(40) + '> ```\n\nafter\n';
    const pq = await cutsRight(quote, 120);
    expect(pq.length).toBeGreaterThan(2);
    expect(pq[0]!.close).toBe('> ```\n');
    expect(pq[1]!.reopen).toBe('> ``` py\n');
    // Tilde fences and a longer marker keep their marker.
    const tilde = '~~~~ yaml\n' + 'key: value\n'.repeat(40) + '~~~~\n';
    const ptl = await cutsRight(tilde, 120);
    expect(ptl[0]!.close).toBe('~~~~\n');
    expect(ptl[1]!.reopen).toBe('~~~~ yaml\n');
  });

  it('md parts at blocks: a code-point tail never begins with a fence marker, and never between a surrogate pair', async () => {
    // One content line holds a run of backticks and a run of tildes: a cut inside it must not leave a tail that starts with three.
    const line = 'p'.repeat(30) + '`'.repeat(12) + 'q'.repeat(10) + '~'.repeat(9) + 'r'.repeat(30);
    for (const lead of ['```', '~~~~~']) {
      const t = lead + '\n' + line + '\n' + line + '\n' + lead + '\nafter\n';
      for (let max = 24; max <= 70; max += 1) {
        const parts = await cut(t, max);
        checkCover(t, parts, max);
        for (const p of parts.slice(1)) {
          expect(t.startsWith('```', p.start) || t.startsWith('~~~', p.start), `max ${max}: a part starts with a fence marker at ${p.start}`).toBe(false);
        }
        if (max >= 40) expect(judgeViolations(t, parts), `max ${max}`).toEqual([]);
      }
    }
    // Four-byte characters on one long line: never a part that starts on a low surrogate.
    const emoji = '```\n' + '\u{1F600}'.repeat(60) + '\n```\n';
    for (let max = 20; max <= 60; max += 1) {
      const parts = await cut(emoji, max);
      checkCover(emoji, parts, max);
      for (const p of parts) {
        const c = emoji.charCodeAt(p.start);
        expect(c >= 0xdc00 && c <= 0xdfff, `max ${max}: a part starts on a low surrogate`).toBe(false);
      }
    }
  });

  it('md parts at blocks: from tailFrom on, P1 cuts the rest', async () => {
    const t = Array.from({ length: 60 }, (_, k) => `Paragraph ${k} ${'w'.repeat(24)}\n\n`).join('');
    const { blocks } = await blocksOf(t);
    const at = blocks[30]!.start;
    const known = blocks.filter((b) => b.start < at);
    const max = 200;
    const { parts } = splitMarkdownPartsAt(t, max, known, at);
    checkCover(t, parts, max);
    expect(parts.some((p) => p.end === at), 'a part ends at tailFrom').toBe(true);
    const rest = splitMarkdownParts(t.slice(at), max).parts.map((p) => [p.start + at, p.end + at, p.reopen, p.close]);
    expect(parts.filter((p) => p.start >= at).map((p) => [p.start, p.end, p.reopen, p.close])).toEqual(rest);
    for (const p of parts.slice(1).filter((q) => q.start < at)) expect(known.some((b) => b.start === p.start), 'before tailFrom, a part starts at a block').toBe(true);
    // From the start, it is the line cutter's own cut.
    expect(splitMarkdownPartsAt(t, max, [], 0).parts).toEqual(splitMarkdownParts(t, max).parts);
  });
});

describe('splitMarkdownPartsAt: the render gate and the fixtures', () => {
  /** A section: a level-2 heading and paragraphs of plain ASCII, about `bytes` long. */
  const section = (n: number, bytes: number): string => {
    const head = `## Section ${n}\n\n`;
    const para = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(16) + '\n\n';
    let body = '';
    while (head.length + body.length + para.length <= bytes) body += para;
    return head + body;
  };
  /** A text of exactly `bytes` ASCII bytes made of sections. */
  const sized = (bytes: number): string => {
    let t = '';
    let n = 1;
    while (t.length < bytes) t += section(n++, 40000);
    return t.slice(0, bytes - 1) + '\n';
  };
  /** Dense mixed Markdown of at least `bytes`: headings, paragraphs, lists, tables, fences, quotes. */
  const dense = (bytes: number): string => {
    let t = '';
    let i = 0;
    while (t.length < bytes) {
      i += 1;
      t += `## Section ${i}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.\n\n`;
      t += `- item ${i}.1\n- item ${i}.2\n  continued text\n- item ${i}.3\n\n`;
      t += `| a | b | c |\n|---|---|---|\n| ${i} | x | y |\n| z | ${i} | w |\n\n`;
      t += '```ts\n' + `const v${i} = ${i};\n`.repeat(8) + '```\n\n';
      t += `> quote ${i}\n> more\n\n1. one\n2. two\n\n`;
    }
    return t;
  };

  it('md parts at blocks: 524 287 and 524 288 bytes stay one part, 524 289 bytes make two', async () => {
    expect(GATE).toBe(524288);
    for (const n of [GATE - 1, GATE]) {
      const t = sized(n);
      expect(utf8Bytes(t)).toBe(n);
      expect(await cut(t, GATE), `${n} bytes`).toEqual([{ start: 0, end: n, continued: false, reopen: null, close: null }]);
    }
    const over = sized(GATE + 1);
    const parts = await cut(over, GATE);
    expect(parts.length).toBe(2);
    checkCover(over, parts, GATE);
  }, 60000);

  it('md parts at blocks: every part at most the gate on the 2 MiB and 3.4 MiB (3 565 158 bytes) fixtures', async () => {
    for (const [bytes, least] of [[2097152, 4], [3565158, 7]] as const) {
      const t = dense(bytes).slice(0, bytes - 1) + '\n';
      expect(utf8Bytes(t)).toBe(bytes);
      const { blocks, tailFrom } = await blocksOf(t);
      expect(tailFrom, 'the whole fixture was read').toBeNull();
      const { parts } = splitMarkdownPartsAt(t, GATE, blocks, tailFrom);
      expect(parts.length, `${bytes} bytes`).toBeGreaterThanOrEqual(least);
      checkCover(t, parts, GATE);
      for (const p of parts.slice(1)) expect(p.continued === (t.startsWith('## ', p.start) ? false : true), `a part starts at a heading or is continued (${p.start})`).toBe(true);
    }
  }, 120000);

  it('md parts incremental: the cut fed window by window is the one-shot cut on the same blocks, and part 1 is final before the last window (2 MiB fixture)', async () => {
    // X2 P6.1 review: no part waited for the whole read. A cutter fed each window's confirmed blocks answers the parts that are
    // final so far, and the rest at the end; together they are `splitMarkdownPartsAt` of the same blocks.
    const text = dense(2097152).slice(0, 2097151) + '\n';
    const cutter = new MarkdownCutter(text, GATE);
    const early: MdPart[] = [];
    let feeds = 0;
    let firstAt = -1;
    const got = await collectMdBlocks(text, askLibrary, new AbortController().signal, {
      onBlocks: (blocks, frontier) => {
        feeds += 1;
        const final = cutter.feed(blocks, frontier);
        if (final.length > 0 && firstAt < 0) firstAt = feeds;
        for (const p of final) early.push(p);
      },
    });
    expect(got.tailFrom).toBeNull();
    const rest = cutter.finish(got.tailFrom);
    expect([...early, ...rest]).toEqual(splitMarkdownPartsAt(text, GATE, got.blocks, got.tailFrom).parts);
    expect(feeds, 'the fixture is read in several windows').toBeGreaterThanOrEqual(4);
    expect(firstAt, 'a part was final after a window').toBeGreaterThan(0);
    expect(firstAt, 'and before the last').toBeLessThan(feeds);
    expect(early.length, 'most parts were final before the end').toBeGreaterThanOrEqual(2);
  }, 120000);

  it('md parts at blocks: linear work on a long text', () => {
    // Synthetic blocks (the cutter does not look at the library): 300 000 paragraphs of a few bytes, a list of 50 000 items, and
    // a fence of 100 000 lines. The probe counts every character the cutter examines (searches, slices or measures).
    const para = 'abc\n\n'.repeat(300000);
    const paraBlocks: TextBlock[] = Array.from({ length: 300000 }, (_, i) => ({ start: i * 5, end: i * 5 + 4, kind: 'other' as const }));
    const probe = { chars: 0 };
    const { parts } = splitMarkdownPartsAt(para, 1000, paraBlocks, null, probe);
    checkCover(para, parts, 1000);
    expect(probe.chars, 'many small blocks').toBeLessThanOrEqual(8 * para.length);
    expect(splitMarkdownPartsAt(para, 1000, paraBlocks, null).parts).toEqual(parts);

    const items = Array.from({ length: 50000 }, (_, i) => `- item ${i}\n`);
    const list = items.join('');
    let at = 0;
    const itemBlocks: TextBlock[] = items.map((s) => { const b: TextBlock = { start: at, end: at + s.length, kind: 'other' }; at += s.length; return b; });
    const listBlock: TextBlock = { start: 0, end: list.length, kind: 'list', items: itemBlocks };
    const pl = { chars: 0 };
    const lp = splitMarkdownPartsAt(list, 1000, [listBlock], null, pl).parts;
    checkCover(list, lp, 1000);
    expect(pl.chars, 'one list of many items').toBeLessThanOrEqual(8 * list.length);

    const body = '```\n' + ('c'.repeat(99) + '\n').repeat(100000) + '```\n';
    const pf = { chars: 0 };
    const fp = splitMarkdownPartsAt(body, 1000, [{ start: 0, end: body.length, kind: 'fence' }], null, pf).parts;
    checkCover(body, fp, 1000);
    expect(pf.chars, 'one fence of 100 000 lines').toBeLessThanOrEqual(8 * body.length);

    // One line of 200 000 bytes in a fence, cut into hundreds of parts: every line scan is counted (`lineEnd` too), and a part
    // never measures the rest of the line again.
    const longLine = '```\n' + 'x'.repeat(200000) + '\nafter\n```\n';
    const pg = { chars: 0 };
    const gp = splitMarkdownPartsAt(longLine, 500, [{ start: 0, end: longLine.length, kind: 'fence' }], null, pg).parts;
    checkCover(longLine, gp, 500);
    expect(gp.length).toBeGreaterThan(300);
    expect(pg.chars, 'one fence line of 200 000 bytes').toBeLessThanOrEqual(8 * longLine.length);
    expect(pg.chars, 'the line scan is counted').toBeGreaterThanOrEqual(longLine.length);
  });
});

/** A stand-in for the worker: a block is a run of non-blank lines, in the lines of the source it is sent. */
function paragraphsOf(src: string): MdBlock[] {
  const lines = src.split(/\r\n|\r|\n/);
  const out: MdBlock[] = [];
  let from = -1;
  lines.forEach((l, i) => {
    if (l.trim() === '') {
      if (from >= 0) { out.push({ from, to: i, kind: 'other' }); from = -1; }
    } else if (from < 0) from = i;
  });
  if (from >= 0) out.push({ from, to: lines.length, kind: 'other' });
  return out;
}

/** The blocks of the whole `text` as `paragraphsOf` finds them, in offsets: what `collectMdBlocks` must answer. */
function truth(text: string): TextBlock[] {
  const ls = lineStartsOf(text);
  return paragraphsOf(text).map((b) => ({ start: ls[b.from]!, end: b.to < ls.length ? ls[b.to]! : text.length, kind: 'other' as const }));
}

describe('collectMdBlocks, blockWindow and foldBlockWindow', { timeout: 60000 }, () => {
  const signal = new AbortController().signal;
  const small = (n: number, k = 0): string => Array.from({ length: n }, (_, i) => `para ${String(i + k).padStart(6, '0')}\n\n`).join('');
  const long = (lines: number): string => ('b'.repeat(99) + '\n').repeat(lines) + '\n';

  it('collectMdBlocks: a window that ends inside a block confirms the blocks before it only', async () => {
    const a = small(30000);
    const big = long(2000);
    const text = a + big + small(30000, 40000);
    const asks: string[] = [];
    const ask = (src: string): Promise<MdBlock[] | null> => { asks.push(src); return Promise.resolve(paragraphsOf(src)); };
    const got = await collectMdBlocks(text, ask, signal);
    expect(got.tailFrom).toBeNull();
    expect(got.blocks).toEqual(truth(text));
    expect(asks.length, 'three windows of the gate').toBe(3);
    expect(utf8Bytes(asks[0]!)).toBeLessThanOrEqual(GATE);
    // The first window ends inside the big block (the paragraphs before it, then part of it): the next starts at the big block.
    expect(asks[0]!.length).toBeLessThan(a.length + big.length);
    expect(asks[1]!.startsWith('\n' + 'b'.repeat(99) + '\n')).toBe(true);
    expect(got.blocks.some((b) => b.start === a.length && b.end === a.length + big.length - 1), 'the whole big block is one block').toBe(true);
  });

  it('collectMdBlocks: one block longer than the window grows the window, then gives up at READER_BLOCKS_MAX_BYTES with tailFrom', async () => {
    const a = small(100);
    const text = a + long(30000) + 'tail\n\n';
    const sizes: number[] = [];
    const ask = (src: string): Promise<MdBlock[] | null> => { sizes.push(utf8Bytes(src)); return Promise.resolve(paragraphsOf(src)); };
    const progress: [number, number][] = [];
    const got = await collectMdBlocks(text, ask, signal, { onProgress: (covered, total) => { progress.push([covered, total]); } });
    expect(got.tailFrom, 'gave up at the start of the long block').toBe(a.length);
    expect(got.blocks).toEqual(truth(a));
    // The first ask; then the long block alone at one gate, two and four (READER_BLOCKS_MAX_BYTES); then no more.
    expect(sizes.length).toBe(4);
    expect(sizes[0]!).toBeLessThanOrEqual(GATE);
    expect(sizes[1]!).toBeLessThanOrEqual(GATE);
    expect(sizes[2]!).toBeLessThanOrEqual(2 * GATE);
    expect(sizes[2]!).toBeGreaterThan(GATE);
    expect(sizes[3]!).toBeLessThanOrEqual(READER_BLOCKS_MAX_BYTES);
    expect(sizes[3]!).toBeGreaterThan(2 * GATE);
    expect(READER_BLOCKS_MAX_BYTES).toBe(4 * GATE);
    expect(progress.length).toBeGreaterThan(0);
    for (const [covered, total] of progress) { expect(covered).toBeLessThanOrEqual(total); expect(total).toBe(utf8Bytes(text)); }
  });

  it('collectMdBlocks: a null answer ends with tailFrom at the last confirmed start', async () => {
    const a = small(30000);
    const text = a + long(2000) + small(30000, 40000);
    let calls = 0;
    const ask = (src: string): Promise<MdBlock[] | null> => { calls += 1; return Promise.resolve(calls === 1 ? paragraphsOf(src) : null); };
    const got = await collectMdBlocks(text, ask, signal);
    expect(got.tailFrom, 'the second window began at the big block').toBe(a.length);
    expect(got.blocks).toEqual(truth(a));
    // A null answer to the first ask: nothing confirmed, the whole text is the tail.
    expect(await collectMdBlocks(text, () => Promise.resolve(null), signal)).toEqual({ blocks: [], tailFrom: 0 });
  });

  it('collectMdBlocks: a window after offset 0 is sent with one leading newline and its lines shifted back', async () => {
    // The first window ends right after a `---` line (the next line is longer than what is left of the gate), so that line is
    // its last block and the second window starts at it. Without the newline, `---`, `title: ...`, `---` would be front matter.
    const lead = Array.from({ length: 16000 }, () => 'lorem ipsum dolor sit amet\n\n').join('');
    const text = lead + '---\n' + 'title: ' + 'x'.repeat(100000) + '\n---\nend\n';
    expect(utf8Bytes(lead) + 4).toBeLessThan(GATE);
    expect(utf8Bytes(lead) + 4 + 100007).toBeGreaterThan(GATE);
    const srcs: string[] = [];
    const ask = (src: string): Promise<MdBlock[] | null> => { srcs.push(src); return askLibrary(src); };
    const got = await collectMdBlocks(text, ask, signal);
    expect(got.tailFrom).toBeNull();
    expect(srcs.length).toBe(2);
    expect(srcs[0]!.startsWith('lorem')).toBe(true);
    expect(srcs[1]!.startsWith('\n---\ntitle: ')).toBe(true);
    const tail = got.blocks.slice(-3);
    const dashes = lead.length;
    const titleAt = lead.length + 4;
    expect(tail.map((b) => [b.start, b.kind]), 'a thematic break, a setext heading, a paragraph: not front matter').toEqual([
      [dashes, 'other'], [titleAt, 'heading'], [text.indexOf('end\n'), 'other'],
    ]);
  });

  it('collectMdBlocks: an abort rejects with the signal\'s reason, before and during an ask, and a finished read reports its progress', async () => {
    const text = small(30000) + long(2000) + small(30000, 40000);
    const before = new AbortController();
    const why = new Error('gone');
    before.abort(why);
    await expect(collectMdBlocks(text, () => Promise.resolve([]), before.signal)).rejects.toBe(why);
    const during = new AbortController();
    const reason = new Error('stopped');
    await expect(collectMdBlocks(text, (src) => { during.abort(reason); return Promise.resolve(paragraphsOf(src)); }, during.signal)).rejects.toBe(reason);
    const seen: number[] = [];
    await collectMdBlocks(text, (src) => Promise.resolve(paragraphsOf(src)), signal, { onProgress: (covered) => { seen.push(covered); } });
    expect(seen.length).toBeGreaterThan(0);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]!).toBeGreaterThan(seen[i - 1]!);
  });

  it('blockWindow: a window ends at a line end within its bytes, or at the end of the text, and is sent with a newline after offset 0', () => {
    const t = 'ab\ncd\nef';
    expect(blockWindow(t, 0, 4)).toMatchObject({ from: 0, end: 3, src: 'ab\n', toEnd: false });
    expect(blockWindow(t, 0, 100)).toMatchObject({ from: 0, end: 8, src: t, toEnd: true });
    expect(blockWindow(t, 3, 100)).toMatchObject({ from: 3, end: 8, src: '\ncd\nef', toEnd: true });
    // The newline counts: 1 + 3 bytes fit a window of 4.
    expect(blockWindow(t, 3, 4)).toMatchObject({ end: 6, src: '\ncd\n', toEnd: false });
    // Bytes, not units: a four-byte character is four.
    const e = '\u{1F600}\n\u{1F600}\n';
    expect(blockWindow(e, 0, 5)).toMatchObject({ end: 3, src: '\u{1F600}\n' });
    // A first line longer than the window is taken whole when it fits the blocks cap; a window never ends between a CR and its LF.
    expect(blockWindow('abcdefgh\nij\n', 0, 4)).toMatchObject({ end: 9, src: 'abcdefgh\n', toEnd: false });
    const crlf = 'a\r\nb\r\nc';
    expect(blockWindow(crlf, 0, 4)).toMatchObject({ end: 3, src: 'a\r\n' });
    expect(blockWindow('a\rb\rc', 0, 3)).toMatchObject({ end: 2, src: 'a\r' });
    // Refused: a first line that does not fit the cap, at offset 0 and after it (the newline counts).
    expect(blockWindow('x'.repeat(READER_BLOCKS_MAX_BYTES) + '\n', 0, 10)).toBeNull();
    expect(blockWindow('x'.repeat(READER_BLOCKS_MAX_BYTES) + '\nyy\n', 0, 10)).toBeNull();
    expect(blockWindow('\n' + 'x'.repeat(READER_BLOCKS_MAX_BYTES - 1) + '\n', 1, 10)).toBeNull();
  });

  it('foldBlockWindow: lines to offsets by markdown-it\'s rule, back one line for a newline-prefixed window; all but the last confirmed', () => {
    const t = 'a\r\n\r\nb\r\nc\n\nd\n';
    const win = blockWindow(t, 0, 100)!;
    const blocks: MdBlock[] = [{ from: 0, to: 1, kind: 'other' }, { from: 2, to: 4, kind: 'other', items: [{ from: 2, to: 3, kind: 'other' }] }, { from: 5, to: 6, kind: 'heading' }];
    expect(foldBlockWindow(t, win, blocks)).toEqual({
      blocks: [
        { start: 0, end: 3, kind: 'other' },
        { start: 5, end: 10, kind: 'other', items: [{ start: 5, end: 8, kind: 'other' }] },
        { start: 11, end: 13, kind: 'heading' },
      ],
      next: null,
      grow: false,
    });
    // A window that does not reach the end: the last block is not confirmed, and its start is where the next window begins.
    const part = blockWindow(t, 0, 9)!;
    expect(part.toEnd).toBe(false);
    expect(foldBlockWindow(t, part, blocks.slice(0, 2))).toEqual({ blocks: [{ start: 0, end: 3, kind: 'other' }], next: 5, grow: false });
    // One block (or none) that does not reach the end: nothing is confirmed.
    expect(foldBlockWindow(t, part, blocks.slice(0, 1))).toEqual({ blocks: [], next: null, grow: true });
    expect(foldBlockWindow(t, part, [])).toEqual({ blocks: [], next: null, grow: true });
    // A window after offset 0 was sent with a newline in front: its lines are one less.
    const after = blockWindow(t, 5, 100)!;
    expect(after.src.startsWith('\n')).toBe(true);
    expect(foldBlockWindow(t, after, [{ from: 1, to: 2, kind: 'other' }, { from: 4, to: 5, kind: 'other' }])).toEqual({
      blocks: [{ start: 5, end: 8, kind: 'other' }, { start: 11, end: 13, kind: 'other' }], next: null, grow: false,
    });
  });
});

// ---- The round-2 review (X2 P6.1 Step 0b2): comments across windows, tails, deep items, and the cut as one L1 function ----------
describe('windows, comments and the cut as a function (review of Step 0b2)', { timeout: 120000 }, () => {
  const lead = (n: number): string => 'lorem ipsum dolor sit amet\n\n'.repeat(n);
  const signal = new AbortController().signal;

  it('collectMdBlocks: a multi-line comment that crosses a window\'s end is one comment, not the blocks inside it', async () => {
    // The library reads a `<!--` block as a comment only when a `-->` follows in the same source: at a window's end it does not,
    // so the comment's inner lines were blocks the whole document does not have (probe 1: 401 false block starts).
    const comment = '<!--\n' + Array.from({ length: 40 }, (_, k) => `## Old heading ${k}\n\nold paragraph ${k}\n\n`).join('') + '-->\n\n';
    const text = lead(70) + comment + 'after the comment.\n\n'.repeat(60);
    const at = lead(70).length;
    const whole = await blocksOf(text, READER_BLOCKS_MAX_BYTES);
    expect(whole.blocks.some((b) => b.start > at && b.start < at + comment.length), 'the whole document has no block in the comment').toBe(false);
    for (const window of [1024, 2048, 3000, 4096]) {
      const small = await blocksOf(text, window);
      expect(small, `window ${window}`).toEqual(whole);
    }
  });

  it('collectMdBlocks: a fence opener inside a comment that crosses a window\'s end does not make the rest of the document code', async () => {
    const comment = '<!--\nOld notes.\n\n' + 'old line\n\n'.repeat(40) + '```js\nold code\n-->\n\n';
    const text = lead(70) + comment + Array.from({ length: 60 }, (_, k) => `## After ${k}\n\nreal paragraph ${k}.\n\n`).join('');
    const whole = await blocksOf(text, READER_BLOCKS_MAX_BYTES);
    for (const window of [2048, 2500]) {
      const small = await blocksOf(text, window);
      expect(small, `window ${window}`).toEqual(whole);
      const parts = splitMarkdownPartsAt(text, 700, small.blocks, small.tailFrom).parts;
      checkCover(text, parts, 700);
      expect(judgeViolations(text, parts), `window ${window}`).toEqual([]);
    }
  });

  it('collectMdBlocks: a `<!--` inside a fence, or closed on its own line, does not hold a window back', async () => {
    const text = lead(60) + '```html\n<!--\nnot a comment\n```\n\n' + lead(30) + '<!-- a one-line note -->\n\n' + lead(30) + '   <!-- id:anchor -->\n\n' + lead(30);
    const whole = await blocksOf(text, READER_BLOCKS_MAX_BYTES);
    for (const window of [1024, 1700, 2048]) expect(await blocksOf(text, window), `window ${window}`).toEqual(whole);
  });

  it('collectMdBlocks: a comment longer than the window grows it, and a comment longer than the cap ends the blocks there (tailFrom)', async () => {
    const comment = '<!--\n' + 'old line\n\n'.repeat(3000) + '-->\n\n';
    const text = lead(50) + comment + lead(50);
    const asked: number[] = [];
    const ask = (src: string): Promise<MdBlock[] | null> => { asked.push(utf8Bytes(src)); return askLibrary(src); };
    const got = await collectMdBlocks(text, ask, signal, { windowBytes: 2048 });
    expect(got.tailFrom).toBeNull();
    expect(got).toEqual(await blocksOf(text, READER_BLOCKS_MAX_BYTES));
    expect(Math.max(...asked), 'the window grew to hold the comment').toBeGreaterThan(utf8Bytes(comment));
  });

  it('md parts: the open-comment scan is linear on a hostile window', () => {
    // Security review of Step 0b2: the scan runs on the console's main thread with no budget, over bytes a hostile document
    // chooses. The work is bounded by the probe's count of characters examined, never by wall time. (a) One line of 200 000
    // characters of spaces and list markers, which fails to be a container prefix at its end (the old prefix test backtracked
    // exponentially over it); (b) one line of 50 000 `<!--` with no closer (the old scan walked back to the line start for each).
    // Each window is cut short by the next, longer line, so it is not the last.
    const hostile: [string, string, boolean][] = [
      ['(b) 50 000 comment openers on one line, after a letter (none is at a line start)', 'x' + '<!--'.repeat(50000), false],
      ['(b0) 50 000 comment openers on one line', '<!--'.repeat(50000), true],
      ['(a) spaces and markers, then a letter, then an opener', '-   '.repeat(50000) + 'x<!--', true],
      ['(a2) the same without the letter, and quote marks', '> -  '.repeat(40000) + '<!--', true],
      ['(c) a hundred thousand lines that each hold a non-prefix and an opener', 'x<!--\n'.repeat(100000), false],
    ];
    for (const [name, line, closed] of hostile) {
      const text = line + '\n' + 'filler line of text\n'.repeat(120000);
      const win = blockWindow(text, 0, 1 << 20)!;
      expect(win.toEnd, name).toBe(false);
      const probe = { chars: 0 };
      const folded = foldBlockWindow(text, win, [{ from: 0, to: 1, kind: 'other' }, { from: 1, to: 2, kind: 'other' }], probe);
      const size = win.end - win.from;
      expect(probe.chars, `${name}: the scan is counted`).toBeGreaterThanOrEqual(line.length);
      expect(probe.chars, `${name}: the work on a window of ${size} characters`).toBeLessThanOrEqual(16 * size);
      // It fails closed: the hostile line holds an open comment as far as the window can tell, so nothing before it is confirmed.
      if (closed) expect(folded.grow, name).toBe(true);
    }
  });

  it('md parts: the tail check of a code-point cut is linear in a long run of white space before a fence marker', () => {
    // A content line of `a`, 30 000 spaces and three backticks, cut inside the run: each step back over the run used to scan
    // forward over it again.
    const t = '```\na' + ' '.repeat(30000) + '```' + 'b'.repeat(20) + '\nafter\n```\n';
    const probe = { chars: 0 };
    const parts = splitMarkdownPartsAt(t, 400, [{ start: 0, end: t.length, kind: 'fence' }], null, probe).parts;
    checkCover(t, parts, 400);
    // Where no cut of the line is safe (inside the run every tail is white space and a marker) the unit is the line cutter's.
    expect(probe.chars, 'work on one line of 30 000 spaces').toBeLessThanOrEqual(16 * t.length);
    expect(probe.chars, 'the scans are counted').toBeGreaterThanOrEqual(t.length);
  });

  it('md parts at blocks: a code-point tail never begins with spaces and a fence marker either (probe 3)', async () => {
    const line = 'a'.repeat(40) + '   ```';
    const t = '```\n' + line + '\n' + 'code after\n'.repeat(3) + '```\n\npara\n';
    for (let max = 40; max <= 69; max += 1) await cutsRight(t, max);
    const quoted = '> ```\n> ' + line + '\n' + '> code after\n'.repeat(3) + '> ```\n\npara\n';
    for (let max = 40; max <= 69; max += 1) await cutsRight(quoted, max);
  });

  it('md parts at blocks: a fence on a later line of an item whose content starts past the marker is reopened inside the item (probe 3)', async () => {
    const t = '-    item text\n      ```js\n' + '      code line\n'.repeat(12) + '      ```\n';
    const parts = await cutsRight(t, 80);
    expect(parts.length).toBeGreaterThan(2);
    const ordered = '1.    item text\n         ```js\n' + '         code line\n'.repeat(12) + '         ```\n';
    await cutsRight(ordered, 90);
  });

  /** The worker's own job as the console's `pre`. */
  const job = (src: string, o: { blocks: true }): Promise<ReaderRenderOutcome> =>
    new Promise((resolve) => { answerRenderJob({ id: 1, kind: 'render', src, blocks: o.blocks }, (r) => { resolve(r.outcome); }); });
  const dense = (n: number): string => Array.from({ length: n }, (_, i) => `## Section ${i}\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit.\n\n- item ${i}\n- more ${i}\n\n\`\`\`ts\nconst v = ${i};\n\`\`\`\n\n`).join('');

  it('cutMarkdownText: the library\'s blocks cut the text window by window, the parts arrive as they become final, and the answer is the one-shot cut', async () => {
    const text = dense(400);
    const asks: number[] = [];
    const seen: MdPart[][] = [];
    const callsAtFirst: number[] = [];
    const all = await cutMarkdownText(text, (src, o) => { asks.push(src.length); return job(src, o); }, signal, {
      maxBytes: 3000, windowBytes: 6000,
      onParts: (ps) => { seen.push(ps); callsAtFirst.push(asks.length); },
    });
    expect(all).toEqual(await cut(text, 3000));
    expect(asks.length, 'several windows').toBeGreaterThan(5);
    expect(seen.length, 'parts arrived in several batches').toBeGreaterThan(2);
    expect(callsAtFirst[0]!, 'the first batch came before the last ask').toBeLessThan(asks.length);
    expect(seen.flat()).toEqual(all.slice(0, seen.flat().length));
  });

  it('cutMarkdownText: a job that answers anything but blocks, or fails, leaves the rest to the line cutter', async () => {
    const text = dense(200);
    const refused = await cutMarkdownText(text, () => Promise.resolve({ kind: 'not-rendered', why: 'over-limit' }), signal, { maxBytes: 3000 });
    expect(refused).toEqual(splitMarkdownParts(text, 3000).parts);
    let calls = 0;
    const failing = (src: string, o: { blocks: true }): Promise<ReaderRenderOutcome> => { calls += 1; return calls === 2 ? Promise.reject(new Error('boom')) : job(src, o); };
    const parts = await cutMarkdownText(text, failing, signal, { maxBytes: 3000, windowBytes: 6000 });
    checkCover(text, parts, 3000);
    expect(parts.length).toBeGreaterThan(3);
    // The first window's blocks cut the start (a part ends at a block start); the rest is the line cutter's.
    const first = await blocksOf(text, 6000);
    expect(first.blocks.some((b) => b.start === parts[1]!.start)).toBe(true);
  });

  it('cutMarkdownText: an abort rejects with the signal\'s reason', async () => {
    const ac = new AbortController();
    const reason = new Error('stopped');
    await expect(cutMarkdownText(dense(100), (src, o) => { ac.abort(reason); return job(src, o); }, ac.signal, { maxBytes: 3000, windowBytes: 6000 })).rejects.toBe(reason);
  });
});
