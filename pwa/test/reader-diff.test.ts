// The reader's bounded client line diff (native Docs reader, completion plan Task 11). `readerDiff` takes two Markdown
// sources and answers which lines of the second are new and after which of its lines something was removed, in the
// line numbering the rendered `data-line` uses; past a bound it answers `unavailable` with the bound's name and never
// a partial result. The cases pin the table of small edits, the line model (CRLF, a lone CR, the final line ending),
// each bound on both sides of its edge, the work budget on fixtures of its own, the output cap, a seeded oracle over
// random small documents, the mapping to the real parser's `data-line`, and that `diff.ts` imports only its two L0 modules.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render } from '@synapsium-labs/pinax-lib/render';
import { DOCS_MAX_DOC_BYTES } from '../../shared/docs';
import { utf8Bytes } from '../../shared/utf8';
import { DOCS_RENDER_GATE_BYTES } from '../src/lib/markdownLimits';
import { READER_HTML_MAX_BYTES } from '../src/lib/readerLimits';
import {
  READER_DIFF_MAX_LINES,
  READER_DIFF_MAX_MARKS,
  READER_DIFF_MAX_WORK,
  readerDiff,
  type ReaderDiff,
} from '../src/docs/reader/diff';

// A pass-through of the L0 byte counter that records the length of every string it is asked about, so a case can say
// what `readerDiff` did and did not hand it. The fixtures below use the real `utf8Bytes` through the same wrapper.
const utf8Calls = vi.hoisted(() => ({ lengths: [] as number[] }));
vi.mock('../../shared/utf8', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../shared/utf8')>();
  return {
    ...real,
    utf8Bytes: (s: string): number => {
      utf8Calls.lengths.push(s.length);
      return real.utf8Bytes(s);
    },
  };
});

type Available = Extract<ReaderDiff, { kind: 'available' }>;

/** The diff, which the case expects to be available. */
function avail(before: string, after: string): Available {
  const d = readerDiff(before, after);
  if (d.kind !== 'available') throw new Error(`expected available, got unavailable (${d.why})`);
  return d;
}

/** The lines as the reader counts them: CRLF, CR and LF each end one line, and the last line ending starts no line. */
function linesOf(s: string): string[] {
  if (s === '') return [];
  const parts = s.split(/\r\n?|\n/);
  if (/(\r\n?|\n)$/.test(s)) parts.pop();
  return parts;
}

const rows = (n: number, prefix: string): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('readerDiff: small edits', () => {
  it('identical texts have no ranges and no removals', () => {
    expect(avail('a\nb', 'a\nb')).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
  });

  it('two empty strings have no ranges and no removals', () => {
    expect(avail('', '')).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
  });

  it('an insertion after line 1 is the range [2,2] and no removal', () => {
    expect(avail('a\nc', 'a\nb\nc')).toEqual({ kind: 'available', ranges: [[2, 2]], removedAfter: [] });
  });

  it('a deletion before the first line is removedAfter 0 and no range', () => {
    expect(avail('x\na\nb', 'a\nb')).toEqual({ kind: 'available', ranges: [], removedAfter: [0] });
  });

  it('replacing line 2 is the range [2,2] and a removal after line 1', () => {
    expect(avail('a\nb\nc', 'a\nB\nc')).toEqual({ kind: 'available', ranges: [[2, 2]], removedAfter: [1] });
  });

  it('a deletion after the last surviving line is marked after that line', () => {
    expect(avail('a\nb\nx', 'a\nb')).toEqual({ kind: 'available', ranges: [], removedAfter: [2] });
  });

  it('two deletions in one gap are one removal', () => {
    expect(avail('a\nx\ny\nb', 'a\nb')).toEqual({ kind: 'available', ranges: [], removedAfter: [1] });
  });

  it('a run of inserted lines is one inclusive range', () => {
    expect(avail('a\nd', 'a\nb\nc\nd')).toEqual({ kind: 'available', ranges: [[2, 3]], removedAfter: [] });
  });

  it('an empty after document removes everything after line 0', () => {
    expect(avail('a\nb\n', '')).toEqual({ kind: 'available', ranges: [], removedAfter: [0] });
  });

  it('an empty before document makes every after line new', () => {
    expect(avail('', 'a\nb')).toEqual({ kind: 'available', ranges: [[1, 2]], removedAfter: [] });
  });

  it('the same input always gives the same answer', () => {
    const a = 'p\nq\nr\nq\np\nq';
    const b = 'q\np\nq\nr\nq\nq';
    expect(readerDiff(a, b)).toEqual(readerDiff(a, b));
  });
});

describe('readerDiff: the line model', () => {
  it('CRLF, LF and a lone CR are the same line ending, in both directions', () => {
    const crlf = 'a\r\nb\r\n';
    const lf = 'a\nb\n';
    const cr = 'a\rb\r';
    for (const [x, y] of [[crlf, lf], [lf, crlf], [crlf, cr], [cr, crlf], [lf, cr], [cr, lf]] as const) {
      expect(avail(x, y)).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
    }
  });

  it('a final line ending starts no line, in both directions', () => {
    expect(avail('a\nb', 'a\nb\n')).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
    expect(avail('a\nb\n', 'a\nb')).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
    expect(avail('a\r\nb', 'a\r\nb\r\n')).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
  });

  it('a second final line ending is a real empty line', () => {
    expect(avail('a\nb\n', 'a\nb\n\n')).toEqual({ kind: 'available', ranges: [[3, 3]], removedAfter: [] });
  });

  it('a lone line ending is one empty line', () => {
    expect(avail('', '\n')).toEqual({ kind: 'available', ranges: [[1, 1]], removedAfter: [] });
    expect(avail('\n', '')).toEqual({ kind: 'available', ranges: [], removedAfter: [0] });
  });

  it('lines compare as exact strings: trailing space and case differ', () => {
    expect(avail('a\nb', 'a\nb ')).toEqual({ kind: 'available', ranges: [[2, 2]], removedAfter: [1] });
    expect(avail('a\nb', 'a\nB')).toEqual({ kind: 'available', ranges: [[2, 2]], removedAfter: [1] });
  });
});

describe('readerDiff: Unicode text', () => {
  const lines = ['café crème', '日本語の行', 'rocket 🚀 here', 'é combining'];

  it('identical accented, CJK, astral and combining lines have no marks', () => {
    expect(avail(lines.join('\n'), lines.join('\n'))).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
  });

  it('a change inside an astral character line is one changed line', () => {
    const after = [lines[0]!, lines[1]!, 'rocket 🚁 here', lines[3]!];
    expect(avail(lines.join('\n'), after.join('\n'))).toEqual({ kind: 'available', ranges: [[3, 3]], removedAfter: [2] });
  });

  it('a precomposed and a combining form of the same letter are different lines', () => {
    expect(avail('é', 'é')).toEqual({ kind: 'available', ranges: [[1, 1]], removedAfter: [0] });
  });
});

describe('readerDiff: the lines bound', () => {
  const n = READER_DIFF_MAX_LINES;
  const doc = (count: number): string => rows(count, 'L').join('\n');

  it('exactly the maximum number of lines on each side is available', () => {
    expect(avail(doc(n), doc(n))).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
    const changed = rows(n, 'L');
    changed[n >> 1] = 'changed';
    expect(avail(doc(n), changed.join('\n'))).toEqual({ kind: 'available', ranges: [[(n >> 1) + 1, (n >> 1) + 1]], removedAfter: [n >> 1] });
  });

  it('one line over on the before side is unavailable for lines', () => {
    expect(readerDiff(doc(n + 1), doc(n))).toEqual({ kind: 'unavailable', why: 'lines' });
  });

  it('one line over on the after side is unavailable for lines', () => {
    expect(readerDiff(doc(n), doc(n + 1))).toEqual({ kind: 'unavailable', why: 'lines' });
  });

  it('identical texts over the bound are unavailable for lines too', () => {
    expect(readerDiff(doc(n + 1), doc(n + 1))).toEqual({ kind: 'unavailable', why: 'lines' });
  });

  it('a final line ending does not count as a line against the bound', () => {
    expect(avail(`${doc(n)}\n`, doc(n))).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
  });

  it('a text of millions of line endings is refused without splitting it into millions of lines', () => {
    const endings = '\n'.repeat(DOCS_MAX_DOC_BYTES);
    expect(utf8Bytes(endings)).toBe(DOCS_MAX_DOC_BYTES);
    const real = String.prototype.split;
    const sizes: number[] = [];
    const spy = vi.spyOn(String.prototype, 'split').mockImplementation(function (this: string, ...args: Parameters<typeof real>) {
      const parts = real.apply(this, args);
      sizes.push(parts.length);
      return parts;
    });
    let answer: ReaderDiff;
    try {
      answer = readerDiff(endings, 'a');
    } finally {
      spy.mockRestore();
    }
    expect(answer).toEqual({ kind: 'unavailable', why: 'lines' });
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(READER_DIFF_MAX_LINES + 2);
  });
});

describe('readerDiff: the bytes bound', () => {
  /** A text of exactly `DOCS_MAX_DOC_BYTES` UTF-8 bytes: one long line of 2-byte characters, then three short lines. */
  const atCap = (): string => `${'é'.repeat(1048573)}\na\nb\nc`;

  it('the fixture is exactly the cap in UTF-8 bytes', () => {
    expect(utf8Bytes(atCap())).toBe(DOCS_MAX_DOC_BYTES);
  });

  it('a side at exactly the cap is not refused for bytes', () => {
    const d = avail(atCap(), atCap());
    expect(d).toEqual({ kind: 'available', ranges: [], removedAfter: [] });
    expect(avail('zz', atCap()).ranges).toEqual([[1, 4]]);
    expect(avail(atCap(), 'zz').removedAfter).toEqual([0]);
  });

  it('one byte over on the before side is unavailable for bytes', () => {
    const over = `${atCap()}x`;
    expect(utf8Bytes(over)).toBe(DOCS_MAX_DOC_BYTES + 1);
    expect(readerDiff(over, 'a')).toEqual({ kind: 'unavailable', why: 'bytes' });
  });

  it('one byte over on the after side is unavailable for bytes', () => {
    expect(readerDiff('a', `${atCap()}x`)).toEqual({ kind: 'unavailable', why: 'bytes' });
  });

  it('a side longer than the cap in UTF-16 code units is refused without the byte counter reading it', () => {
    const long = 'x'.repeat(DOCS_MAX_DOC_BYTES + 1);
    utf8Calls.lengths.length = 0;
    expect(readerDiff(long, 'a')).toEqual({ kind: 'unavailable', why: 'bytes' });
    expect(readerDiff('a', long)).toEqual({ kind: 'unavailable', why: 'bytes' });
    for (const length of utf8Calls.lengths) expect(length).toBeLessThanOrEqual(DOCS_MAX_DOC_BYTES);
  });

  it('bytes are refused before lines: too many bytes and too many lines say bytes', () => {
    const bigLines = `${'é'.repeat(1048573)}${'\n'.repeat(READER_DIFF_MAX_LINES + 5)}`;
    expect(utf8Bytes(bigLines)).toBeGreaterThan(DOCS_MAX_DOC_BYTES);
    expect(readerDiff(bigLines, 'a')).toEqual({ kind: 'unavailable', why: 'bytes' });
  });
});

describe('readerDiff: the work budget', () => {
  const disjoint = (n: number): [string, string] => [rows(n, 'old').join('\n'), rows(n, 'new').join('\n')];

  it('the budget is the approved 2 000 000 units', () => {
    expect(READER_DIFF_MAX_WORK).toBe(2_000_000);
  });

  it('300 unique lines against 300 other unique lines is covered by the budget', () => {
    const [a, b] = disjoint(300);
    expect(avail(a, b)).toEqual({ kind: 'available', ranges: [[1, 300]], removedAfter: [0] });
  });

  it('750 unique lines against 750 other unique lines exhaust the budget and nothing else is over', () => {
    const [a, b] = disjoint(750);
    expect(utf8Bytes(a)).toBeLessThan(DOCS_MAX_DOC_BYTES);
    expect(linesOf(a).length).toBeLessThan(READER_DIFF_MAX_LINES);
    expect(readerDiff(a, b)).toEqual({ kind: 'unavailable', why: 'work' });
  });

  // Disjoint N against N lines cost about 4N^2 units in comparisons and advances together plus about 4N^2 in trace
  // cells. At N = 550 the full accounting is about 2.42 million, and leaving out the comparisons (about 1.82 million)
  // or the trace cells (about 1.21 million) falls under the budget, so each uncounted kind is a red case here.
  it('550 against 550 disjoint lines is over the budget only when every kind of work is counted', () => {
    const [a, b] = disjoint(550);
    expect(readerDiff(a, b)).toEqual({ kind: 'unavailable', why: 'work' });
  });

  it('450 against 450 disjoint lines is under the budget with every kind of work counted', () => {
    const [a, b] = disjoint(450);
    expect(avail(a, b)).toEqual({ kind: 'available', ranges: [[1, 450]], removedAfter: [0] });
  });

  it('one side empty never searches: 20 000 inserted lines are one range', () => {
    const big = rows(READER_DIFF_MAX_LINES, 'n').join('\n');
    expect(avail('', big)).toEqual({ kind: 'available', ranges: [[1, READER_DIFF_MAX_LINES]], removedAfter: [] });
    expect(avail(big, '')).toEqual({ kind: 'available', ranges: [], removedAfter: [0] });
  });

  it('a long shared head and tail are trimmed, so a small change in a big text is cheap', () => {
    const base = rows(READER_DIFF_MAX_LINES, 'k');
    const edited = base.slice();
    edited[9000] = 'edited';
    expect(avail(base.join('\n'), edited.join('\n'))).toEqual({ kind: 'available', ranges: [[9001, 9001]], removedAfter: [9000] });
  });
});

describe('readerDiff: the output cap', () => {
  /** Stable lines `s0`.., with a unique line inserted or removed in the first `count` gaps as `kinds` says. */
  function gaps(kinds: readonly ('ins' | 'del')[]): [string, string] {
    const before: string[] = ['s0'];
    const after: string[] = ['s0'];
    kinds.forEach((kind, i) => {
      if (kind === 'ins') after.push(`add${i}`);
      else before.push(`gone${i}`);
      before.push(`s${i + 1}`);
      after.push(`s${i + 1}`);
    });
    return [before.join('\n'), after.join('\n')];
  }
  const many = (n: number, kind: 'ins' | 'del'): ('ins' | 'del')[] => Array.from({ length: n }, () => kind);

  it('the cap is the approved 512 marks', () => {
    expect(READER_DIFF_MAX_MARKS).toBe(512);
  });

  it('512 isolated insertions are available as exactly 512 ranges', () => {
    const [a, b] = gaps(many(512, 'ins'));
    const d = avail(a, b);
    expect(d.ranges).toHaveLength(512);
    expect(d.removedAfter).toEqual([]);
  });

  it('513 isolated insertions are unavailable for output, and the work budget is not what refuses them', () => {
    const [a, b] = gaps(many(513, 'ins'));
    expect(readerDiff(a, b)).toEqual({ kind: 'unavailable', why: 'output' });
    // The same texts with one gap fewer are available, so the work budget covers this shape.
    expect(avail(...gaps(many(512, 'ins')))).toMatchObject({ kind: 'available' });
  });

  it('a text over the work budget whose marks are also over the output cap answers work: output is counted after a search that fits', () => {
    const [gapsBefore, gapsAfter] = gaps(many(513, 'ins'));
    expect(readerDiff(gapsBefore, gapsAfter)).toEqual({ kind: 'unavailable', why: 'output' });
    // the same gaps, then a disjoint block that alone exhausts the budget (see the work budget cases)
    const block = (prefix: string): string => rows(550, prefix).join('\n');
    const before = `${gapsBefore}\n${block('old')}`;
    const after = `${gapsAfter}\n${block('new')}`;
    expect(readerDiff(block('old'), block('new'))).toEqual({ kind: 'unavailable', why: 'work' });
    expect(readerDiff(before, after)).toEqual({ kind: 'unavailable', why: 'work' });
  });

  it('256 isolated insertions and 256 isolated deletions are 512 marks and available', () => {
    const [a, b] = gaps([...many(256, 'ins'), ...many(256, 'del')]);
    const d = avail(a, b);
    expect(d.ranges).toHaveLength(256);
    expect(d.removedAfter).toHaveLength(256);
  });

  it('256 insertions and 257 deletions are 513 marks and unavailable for output', () => {
    const [a, b] = gaps([...many(256, 'ins'), ...many(257, 'del')]);
    expect(readerDiff(a, b)).toEqual({ kind: 'unavailable', why: 'output' });
  });

  it('256 insertions and 256 deletions in alternating gaps are 512 marks and available', () => {
    const kinds = Array.from({ length: 512 }, (_, i): 'ins' | 'del' => (i % 2 === 0 ? 'ins' : 'del'));
    const [a, b] = gaps(kinds);
    expect(avail(a, b).ranges).toHaveLength(256);
  });
});

describe('readerDiff: the real parser\'s data-line', () => {
  /** The `data-line` start of each rendered block, and its end, read out of the library's html for `src`. */
  function renderedLines(src: string): { start: number; end: number }[] {
    const out = render(src, { maxBytes: DOCS_RENDER_GATE_BYTES, maxHtmlBytes: READER_HTML_MAX_BYTES });
    if (out.outcome !== 'rendered') throw new Error(`not rendered: ${out.outcome}`);
    const found: { start: number; end: number }[] = [];
    for (const m of out.html.matchAll(/data-line="(\d+)(?:-(\d+))?"/g)) {
      const start = Number(m[1]);
      found.push({ start, end: m[2] === undefined ? start : Number(m[2]) });
    }
    return found;
  }

  const variants: [string, (s: string) => string][] = [
    ['LF, no final newline', (s) => s],
    ['LF, final newline', (s) => `${s}\n`],
    ['CRLF, no final newline', (s) => s.replace(/\n/g, '\r\n')],
    ['CRLF, final newline', (s) => `${s}\n`.replace(/\n/g, '\r\n')],
    ['lone CR, no final newline', (s) => s.replace(/\n/g, '\r')],
    ['lone CR, final newline', (s) => `${s}\n`.replace(/\n/g, '\r')],
  ];

  /** The line count of `after` by the diff's own model: the end of the one range `readerDiff('', after)` answers. */
  function diffLineCount(after: string): number {
    const { ranges } = avail('', after);
    if (ranges.length === 0) return 0;
    expect(ranges).toHaveLength(1);
    return ranges[0]![1];
  }
  const largestEnd = (blocks: { end: number }[]): number => Math.max(0, ...blocks.map((b) => b.end));
  const beforeText = 'para one\n\npara three\n\npara five';
  const afterText = 'para one\n\nfresh paragraph\n\npara three\n\npara five';

  for (const [name, wrap] of variants) {
    it(`an inserted paragraph carries data-line at the diff's line, and no block is past the last line (${name})`, () => {
      const before = wrap(beforeText);
      const after = wrap(afterText);
      const d = avail(before, after);
      // the new paragraph and the blank line after it
      expect(d.ranges).toEqual([[3, 4]]);
      const blocks = renderedLines(after);
      expect(blocks.some((b) => b.start === 3)).toBe(true);
      const count = linesOf(after).length;
      expect(count).toBe(7);
      for (const b of blocks) {
        expect(b.start).toBeGreaterThanOrEqual(1);
        expect(b.end).toBeLessThanOrEqual(count);
      }
      // the diff's own line count is the model the data-line is read against, and this text ends in a block
      expect(diffLineCount(after)).toBe(count);
      expect(largestEnd(blocks)).toBe(diffLineCount(after));
    });
  }

  it('a source of only a final newline after a paragraph renders no block past the diff\'s last line', () => {
    const after = 'solo\n';
    const count = linesOf(after).length;
    expect(count).toBe(1);
    for (const b of renderedLines(after)) expect(b.end).toBeLessThanOrEqual(count);
    expect(largestEnd(renderedLines(after))).toBe(diffLineCount(after));
  });

  it('an empty after has no diff line and no rendered block', () => {
    expect(diffLineCount('')).toBe(0);
    expect(largestEnd(renderedLines(''))).toBe(0);
  });

  it('a text that ends in blank lines has at least as many diff lines as its last rendered block ends', () => {
    for (const after of ['para\n\n\n', 'para\r\n\r\n\r\n', 'para\r\r\r', 'para\n\n\nmore\n\n']) {
      expect(diffLineCount(after), JSON.stringify(after)).toBeGreaterThanOrEqual(largestEnd(renderedLines(after)));
    }
  });
});

describe('readerDiff: a seeded oracle over small random documents', () => {
  /** mulberry32 with a literal seed: the same sequence on every run. */
  function prng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** The longest common subsequence length of two line lists, by the textbook table. */
  function lcsLength(a: readonly string[], b: readonly string[]): number {
    const w = b.length + 1;
    const t = new Int32Array((a.length + 1) * w);
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        t[i * w + j] = a[i - 1] === b[j - 1] ? t[(i - 1) * w + j - 1]! + 1 : Math.max(t[(i - 1) * w + j]!, t[i * w + j - 1]!);
      }
    }
    return t[a.length * w + b.length]!;
  }

  const isSubsequence = (small: readonly string[], big: readonly string[]): boolean => {
    let i = 0;
    for (const x of big) if (i < small.length && small[i] === x) i += 1;
    return i === small.length;
  };

  /** The after-line numbers a diff marks as new. */
  function coveredSet(d: Available): Set<number> {
    const set = new Set<number>();
    for (const [x, y] of d.ranges) for (let i = x; i <= y; i += 1) set.add(i);
    return set;
  }

  /**
   * Whether the diff's removals are exactly where some optimal alignment loses lines. The survivors are the after lines
   * `ranges` leave out, in order. The answer is valid iff the survivors embed in the before lines, in order and by exact
   * line, so that every gap (before the first survivor, marked 0; between two, marked after the earlier; after the last,
   * marked after it, or 0 when there is no survivor) holds a before line exactly when its mark is in `removedAfter`.
   * Different optimal alignments place removals differently, so no single reference alignment is compared.
   */
  function removalsAreValid(before: readonly string[], after: readonly string[], d: Available): boolean {
    const covered = coveredSet(d);
    const marks = new Set(d.removedAfter);
    const survivorAt: number[] = [];
    for (let i = 1; i <= after.length; i += 1) if (!covered.has(i)) survivorAt.push(i);
    const allowed = new Set<number>([0, ...survivorAt]);
    if (marks.size !== d.removedAfter.length) return false;
    for (const mark of marks) if (!allowed.has(mark)) return false;
    const n = before.length;
    const L = survivorAt.length;
    const gapOk = (mark: number, size: number): boolean => size > 0 === marks.has(mark);
    if (L === 0) return gapOk(0, n);
    // reach[j]: survivor i can sit at before line j with every gap before it matching its mark
    let reach: boolean[] = before.map((line, j) => line === after[survivorAt[0]! - 1] && gapOk(0, j));
    for (let i = 1; i < L; i += 1) {
      const next: boolean[] = before.map(() => false);
      for (let j = 0; j < n; j += 1) {
        if (before[j] !== after[survivorAt[i]! - 1]) continue;
        for (let p = 0; p < j; p += 1) {
          if (reach[p] && gapOk(survivorAt[i - 1]!, j - p - 1)) {
            next[j] = true;
            break;
          }
        }
      }
      reach = next;
    }
    return reach.some((ok, j) => ok && gapOk(survivorAt[L - 1]!, n - 1 - j));
  }

  it('the removal check rejects a removal marked after the next survivor', () => {
    const before = ['a', 'x', 'b', 'c'];
    const after = ['a', 'b', 'c'];
    expect(avail(before.join('\n'), after.join('\n')).removedAfter).toEqual([1]);
    expect(removalsAreValid(before, after, { kind: 'available', ranges: [], removedAfter: [1] })).toBe(true);
    expect(removalsAreValid(before, after, { kind: 'available', ranges: [], removedAfter: [2] })).toBe(false);
    expect(removalsAreValid(before, after, { kind: 'available', ranges: [], removedAfter: [] })).toBe(false);
  });

  it('the removal check wants one removal for each separated deletion gap', () => {
    const before = ['a', 'x', 'b', 'y', 'c'];
    const after = ['a', 'b', 'c'];
    expect(avail(before.join('\n'), after.join('\n')).removedAfter).toEqual([1, 2]);
    expect(removalsAreValid(before, after, { kind: 'available', ranges: [], removedAfter: [1, 2] })).toBe(true);
    expect(removalsAreValid(before, after, { kind: 'available', ranges: [], removedAfter: [1] })).toBe(false);
    expect(removalsAreValid(before, after, { kind: 'available', ranges: [], removedAfter: [2] })).toBe(false);
  });

  it('2 000 random pairs satisfy the oracle, the shape rules, where removals land and symmetry', () => {
    const rnd = prng(20261117);
    const alphabet = ['a', 'b', 'c', 'd'];
    const side = (): { text: string; lines: string[] } => {
      const alpha = alphabet.slice(0, 3 + Math.floor(rnd() * 2));
      const n = Math.floor(rnd() * 13);
      const lines = Array.from({ length: n }, () => alpha[Math.floor(rnd() * alpha.length)]!);
      const sep = rnd() < 0.25 ? '\r\n' : '\n';
      const text = lines.join(sep) + (n > 0 && rnd() < 0.3 ? sep : '');
      return { text, lines };
    };
    const started = performance.now();
    for (let c = 0; c < 2000; c += 1) {
      const x = side();
      const y = side();
      const label = `pair ${c}: ${JSON.stringify(x.text)} -> ${JSON.stringify(y.text)}`;
      // the generator's own line list is the reader's line model for its text
      expect(linesOf(x.text), label).toEqual(x.lines);
      expect(linesOf(y.text), label).toEqual(y.lines);
      const lcs = lcsLength(x.lines, y.lines);
      const d = avail(x.text, y.text);
      // ranges are 1-based, inclusive, ascending, and apart: a surviving line lies between two of them
      let prevEnd = -1;
      for (const [from, to] of d.ranges) {
        expect(from, label).toBeGreaterThanOrEqual(1);
        expect(to, label).toBeGreaterThanOrEqual(from);
        expect(to, label).toBeLessThanOrEqual(y.lines.length);
        if (prevEnd !== -1) expect(from, label).toBeGreaterThan(prevEnd + 1);
        prevEnd = to;
      }
      const covered = coveredSet(d);
      const survivors = y.lines.filter((_, i) => !covered.has(i + 1));
      expect(isSubsequence(survivors, x.lines), label).toBe(true);
      expect(survivors.length, label).toBe(lcs);
      expect(removalsAreValid(x.lines, y.lines, d), label).toBe(true);
      let prevRemoved = -1;
      for (const r of d.removedAfter) {
        expect(r, label).toBeGreaterThan(prevRemoved);
        expect(r, label).toBeGreaterThanOrEqual(0);
        expect(r, label).toBeLessThanOrEqual(y.lines.length);
        if (r !== 0) expect(covered.has(r), label).toBe(false);
        prevRemoved = r;
      }
      expect(d.removedAfter.length === 0, label).toBe(x.lines.length === lcs);
      const back = avail(y.text, x.text);
      expect(coveredSet(back).size, label).toBe(x.lines.length - lcs);
      expect(removalsAreValid(y.lines, x.lines, back), label).toBe(true);
      expect(coveredSet(d).size, label).toBe(y.lines.length - lcs);
    }
    // a finite bound on the whole oracle, not a benchmark
    expect(performance.now() - started).toBeLessThan(20000);
  });
});

describe('readerDiff: what diff.ts imports', () => {
  it('imports only the two L0 modules, no library, DOM, worker or api module', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/docs/reader/diff.ts'), 'utf8');
    const specs = new Set<string>();
    for (const m of src.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)) specs.add(m[1]!);
    for (const m of src.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specs.add(m[1]!);
    expect([...specs].sort()).toEqual(['../../../../shared/docs', '../../../../shared/utf8']);
    expect(src).not.toMatch(/\bimport\s*\(/);
  });
});
