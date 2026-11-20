// X2 P1 review F1 (spec 4.3): a text file above its class cap (up to the range ceiling), and a stat-pinned text draft of any
// size, is shown as SOURCE in parts of at most the cap, one part at a time under the part bar, each part through the same
// source and highlight body a text file under the cap gets. The cutter is pure (`splitSourceParts`); the leaf reads the file
// by range and decodes it as UTF-8, and bytes that are not UTF-8 keep the Download. Placeholders only (`demo`, `specs/...`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DOCS_MAX_DOC_BYTES, type DocsTreeOk } from '../../shared/docs';
import { DocsLeaf, RangeSource } from '../src/docs/DocsLeaf';
import { DOC_NOT_UTF8_NOTE } from '../src/docs/DocMarkdown';
import { ExportBodyContext, type ExportBody } from '../src/docs/exportBody';
import type { RangeBytes } from '../src/docs/range/RangeLeaf';
import { DOCS_RANGE_TEXT, fillSentence, mib } from '../src/docs/docsText';
import { useDocsVisit } from '../src/docs/useDocsVisit';
import { HighlighterContext } from '../src/lib/highlighterContext';
import { HLJS } from '../src/lib/highlightGrammars';
import { parseMarkdown } from '../src/lib/markdownParse';
import { splitSourceParts } from '../src/docs/range/textParts';
import { BLOB_1, draftOf, entry, fakeLoaders, holder, okTree, pageAt, servingLoader, treeOk } from './docsFixtures';
import { inThreadContext, inThreadHighlighter } from './highlightTestStore';

afterEach(cleanup);

const enc = new TextEncoder();
const bytesOf = (s: string): number => enc.encode(s).length;

describe('splitSourceParts: the cutter', () => {
  it('source parts: 2 097 151 and 2 097 152 bytes stay one part, 2 097 153 bytes make two', () => {
    for (const [n, count] of [[DOCS_MAX_DOC_BYTES - 1, 1], [DOCS_MAX_DOC_BYTES, 1], [DOCS_MAX_DOC_BYTES + 1, 2]] as const) {
      const { parts } = splitSourceParts('a'.repeat(n), DOCS_MAX_DOC_BYTES);
      expect(parts, `${String(n)} bytes`).toHaveLength(count);
      expect(parts.reduce((sum, p) => sum + p.bytes, 0), 'the parts hold every byte').toBe(n);
      expect(Math.max(...parts.map((p) => p.bytes))).toBeLessThanOrEqual(DOCS_MAX_DOC_BYTES);
    }
  });

  it('source parts: text of no length is one empty part, and a bound below one code point throws', () => {
    expect(splitSourceParts('', 16).parts).toEqual([{ start: 0, end: 0, bytes: 0, continued: false }]);
    expect(() => splitSourceParts('abc', 3)).toThrow(RangeError);
    expect(() => splitSourceParts('abc', 4.5)).toThrow(RangeError);
  });

  it('source parts: a part ends at the last line end that fits, and the next starts at a line start', () => {
    const { parts } = splitSourceParts('aaa\nbbb\nccc\n', 8);
    expect(parts.map((p) => [p.start, p.end, p.continued])).toEqual([[0, 8, false], [8, 12, false]]);
  });

  it('source parts: a character of several bytes is never split, whatever its width at the cut', () => {
    for (const ch of ['é', '€', '😀']) {
      const text = ch.repeat(40);
      const { parts } = splitSourceParts(text, 10);
      expect(parts.map((p) => text.slice(p.start, p.end)).join('')).toBe(text);
      for (const p of parts) {
        const piece = text.slice(p.start, p.end);
        expect(bytesOf(piece), ch).toBe(p.bytes);
        expect(p.bytes, ch).toBeLessThanOrEqual(10);
        expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(piece), `${ch} lone surrogate`).toBe(false);
      }
    }
  });

  it('source parts: CRLF is never split, a cut before the pair backs off the carriage return', () => {
    // 9 bytes, a CR (the tenth) and then its LF: the bound falls between the two.
    const text = 'x'.repeat(9) + '\r\n' + 'y'.repeat(9);
    const { parts } = splitSourceParts(text, 10);
    const pieces = parts.map((p) => text.slice(p.start, p.end));
    expect(pieces.join('')).toBe(text);
    for (const piece of pieces) {
      expect(piece.endsWith('\r'), JSON.stringify(piece)).toBe(false);
      expect(piece.startsWith('\n'), JSON.stringify(piece)).toBe(false);
    }
    // And CRLF lines cut at the line end as any lines are, the pair whole in its part.
    const lines = 'abc\r\ndef\r\nghi\r\n';
    expect(splitSourceParts(lines, 10).parts.map((p) => lines.slice(p.start, p.end))).toEqual(['abc\r\ndef\r\n', 'ghi\r\n']);
  });

  it('source parts: one line longer than a part is cut at the part size, each later piece marked as continuing', () => {
    const { parts } = splitSourceParts('a'.repeat(25), 10);
    expect(parts.map((p) => [p.bytes, p.continued])).toEqual([[10, false], [10, true], [5, true]]);
    expect(splitSourceParts('ab\n' + 'c'.repeat(12), 10).parts.map((p) => p.continued), 'a part after a line end is not a continuation')
      .toEqual([false, false, true]);
  });

  it('source parts: random text of mixed widths, any bound: contiguous, non-empty, within the bound, bytes summing to the text', () => {
    let seed = 12345;
    const next = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const alphabet = ['a', 'b', ' ', '\n', '\n', '\r\n', 'é', '€', '😀'];
    for (let round = 0; round < 60; round += 1) {
      let text = '';
      for (let i = 0, len = next(400); i < len; i += 1) text += alphabet[next(alphabet.length)]!;
      const max = 4 + next(40);
      const { parts } = splitSourceParts(text, max);
      let at = 0;
      for (const p of parts) {
        expect(p.start, `round ${String(round)} contiguous`).toBe(at);
        expect(p.end > p.start || text.length === 0, 'non-empty').toBe(true);
        expect(bytesOf(text.slice(p.start, p.end)), 'bytes are the part\'s').toBe(p.bytes);
        expect(p.bytes, 'within the bound').toBeLessThanOrEqual(max);
        at = p.end;
      }
      expect(at, 'covers the text').toBe(text.length);
      expect(parts.reduce((sum, p) => sum + p.bytes, 0), 'the parts hold every byte').toBe(bytesOf(text));
    }
  });

  it('source parts: linear, no character is read more than twice, worst case lines just over half a part', () => {
    const max = 1000;
    const text = ('a'.repeat(max / 2) + '\n').repeat(400);
    const spy = vi.spyOn(String.prototype, 'codePointAt');
    try {
      splitSourceParts(text, max);
      expect(spy.mock.calls.length).toBeLessThanOrEqual(2 * text.length);
    } finally {
      spy.mockRestore();
    }
  });

  it('source parts: linear on a line many parts long, and on a short line before one, each character read at most twice', () => {
    const max = 1000;
    const spy = vi.spyOn(String.prototype, 'codePointAt');
    const indexOf = vi.spyOn(String.prototype, 'indexOf');
    try {
      for (const text of ['a'.repeat(max * 60), 'ab\n' + 'a'.repeat(max * 60), ('a'.repeat(300) + '\n').repeat(500)]) {
        spy.mockClear();
        indexOf.mockClear();
        const { parts } = splitSourceParts(text, max);
        expect(parts.map((p) => text.slice(p.start, p.end)).join('')).toBe(text);
        expect(spy.mock.calls.length, 'code points read').toBeLessThanOrEqual(2 * text.length);
        // A line end is searched for once: a miss (no line end left) is remembered, so a line sixty parts long costs one
        // search, not one a part, and the searches are one a line end and one for the end of the text at most.
        expect(indexOf.mock.calls.length, 'searches for a line end').toBeLessThanOrEqual(text.split('\n').length);
      }
    } finally {
      spy.mockRestore();
      indexOf.mockRestore();
    }
  });

});

/** Lines of ten bytes, `n` of them: a text file a little over 3 MiB at 314 573 lines. */
const lines = (n: number): Uint8Array<ArrayBuffer> => enc.encode('abcdefghi\n'.repeat(n)) as Uint8Array<ArrayBuffer>;

/** `url` opened as a leaf of `tree`, reading by range from `src`. */
function openLeaf(url: string, tree: DocsTreeOk, src: Uint8Array<ArrayBuffer>, wrap: (n: React.ReactNode) => React.ReactNode = (n) => n) {
  const f = fakeLoaders({ tree: okTree(tree) });
  const s = servingLoader(src);
  const located = pageAt(url);
  if (located.kind !== 'path') throw new Error('fixture: not a leaf');
  const page = located;
  const parser = async (text: string) => parseMarkdown(text, 'docs');
  function Harness(): React.ReactNode {
    const visit = useDocsVisit(page, f.loaders);
    if (visit.tree?.s !== 'ok') return null;
    return <DocsLeaf visit={visit} tree={visit.tree.answer.tree} page={page} parser={parser} rangeLoader={s.loader} />;
  }
  return { f, s, ...render(wrap(<Harness />)) };
}

const plain = (c: HTMLElement): string => c.querySelector('pre.doc-plain')?.textContent ?? '';

describe('DocsLeaf: a text file above its cap is shown as source in parts', () => {
  it('source parts: a committed text file of 3 MiB renders part 1 as source under a part bar, and Next and Previous move parts', async () => {
    const src = lines(314573);
    const tree = treeOk({ entries: [entry('specs', 'big.txt', { committed: { kind: 'file', blob: BLOB_1, size: src.length } })] });
    const { container, f, s } = openLeaf('/docs/demo/specs/big.txt', tree, src);
    await waitFor(() => expect(screen.getByText('Part 1 of 2')).toBeTruthy(), { timeout: 20000 });
    expect(f.file, 'the file route is not asked').not.toHaveBeenCalled();
    expect(s.prepares()).toBe(1);
    const first = plain(container);
    expect(bytesOf(first), 'part 1 is at most 2 MiB').toBeLessThanOrEqual(DOCS_MAX_DOC_BYTES);
    expect(first.startsWith('abcdefghi\nabcdefghi\n')).toBe(true);
    expect(first.endsWith('\n'), 'cut at a line end').toBe(true);
    expect(screen.queryByText(/offers it as a Download/), 'no longer a Download only').toBeNull();
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.partNext));
    expect(screen.getByText('Part 2 of 2')).toBeTruthy();
    const second = plain(container);
    expect(first.length + second.length, 'the two parts are the whole file').toBe(src.length);
    expect(bytesOf(second)).toBeLessThanOrEqual(DOCS_MAX_DOC_BYTES);
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.partPrevious));
    expect(screen.getByText('Part 1 of 2')).toBeTruthy();
    expect(plain(container)).toBe(first);
  }, 60000);

  it('source parts: a stat-pinned text draft below 2 MiB renders as source by range, through the leaf\'s highlight body', async () => {
    const src = enc.encode('{"a": 1}\n{"b": [true, null]}\n') as Uint8Array<ArrayBuffer>;
    const tree = treeOk({
      drafts: holder(),
      entries: [entry('specs', 'a.json', { draft: draftOf('modified', { fp: null, size: src.length, mtimeNs: '1700000000000000000' }) })],
    });
    const spy = vi.spyOn(HLJS, 'highlight');
    try {
      const { container, f, s } = openLeaf('/docs/demo/specs/a.json?ref=main', tree, src,
        (n) => <HighlighterContext value={inThreadContext(inThreadHighlighter())}>{n}</HighlighterContext>);
      // Coloured by the page's highlight store: the part is the leaf's one code block, with a grammar's own classes.
      await waitFor(() => expect(container.querySelector('pre code [class*="hljs-"]')).not.toBeNull());
      expect(f.file, 'a draft with no fingerprint is never asked of the file route').not.toHaveBeenCalled();
      expect(s.prepares()).toBe(1);
      expect(container.querySelector('pre code')?.textContent, 'the leaf\'s block drops one final newline, as for a file under the cap')
        .toBe('{"a": 1}\n{"b": [true, null]}');
      expect(spy, 'the part was coloured with the json grammar').toHaveBeenCalledWith('{"a": 1}\n{"b": [true, null]}', expect.objectContaining({ language: 'json' }));
      expect(screen.queryByText('Part 1 of 1'), 'one part has no bar').toBeNull();
      expect(screen.queryByText(/offers it as a Download/)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it('source parts: a part of the leaf says it is one of several, and a part that carries on a long line says so', async () => {
    // One line, no line end: every part after the first continues it.
    const src = enc.encode('z'.repeat(DOCS_MAX_DOC_BYTES + 10)) as Uint8Array<ArrayBuffer>;
    const tree = treeOk({ entries: [entry('specs', 'one.log', { committed: { kind: 'file', blob: BLOB_1, size: src.length } })] });
    openLeaf('/docs/demo/specs/one.log', tree, src);
    await waitFor(() => expect(screen.getByText('Part 1 of 2')).toBeTruthy(), { timeout: 20000 });
    expect(screen.queryByText(DOCS_RANGE_TEXT.partContinued)).toBeNull();
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.partNext));
    expect(screen.getByText(DOCS_RANGE_TEXT.partContinued)).toBeTruthy();
    expect(screen.getByText(fillSentence(DOCS_RANGE_TEXT.sourceParts, { size: mib(src.length), part: mib(DOCS_MAX_DOC_BYTES) }))).toBeTruthy();
  }, 60000);

  const statDraft = (path: string, size: number): DocsTreeOk => treeOk({
    drafts: holder(),
    entries: [entry('specs', path, { draft: draftOf('modified', { fp: null, size, mtimeNs: '1700000000000000000' }) })],
  });

  it('source parts: a file under the cap that is not UTF-8 shows the plain view with its note, as a text file under the cap does', async () => {
    const src = new Uint8Array([0x61, 0xff, 0xfe, 0x62, 0x0a]);
    const { container, s } = openLeaf('/docs/demo/specs/a.log?ref=main', statDraft('a.log', src.length), src);
    await waitFor(() => expect(s.prepares()).toBe(1));
    await waitFor(() => expect(screen.getByText(DOC_NOT_UTF8_NOTE)).toBeTruthy());
    expect(container.querySelector('pre.doc-plain')?.textContent, 'each bad sequence is U+FFFD').toBe('a��b\n');
    expect(screen.queryByText(/offers it as a Download/)).toBeNull();
    expect(screen.queryByText(/Part \d of \d/)).toBeNull();
    expect(screen.getByText('Download')).toBeTruthy();
  });

  it('source parts: a file above the cap that is not UTF-8 stays Download-only, never one plain view of megabytes', async () => {
    const src = new Uint8Array(DOCS_MAX_DOC_BYTES + 1).fill(0x61);
    src[10] = 0xff;
    const { container, s } = openLeaf('/docs/demo/specs/a.log?ref=main', statDraft('a.log', src.length), src);
    await waitFor(() => expect(s.prepares()).toBe(1));
    // The leaf shows the Download sentence for a first render too, before it has read anything: wait for the read to end.
    await waitFor(() => expect(screen.queryByText(DOCS_RANGE_TEXT.cancel)).toBeNull());
    expect(screen.getByText(/offers it as a Download/)).toBeTruthy();
    expect(container.querySelector('pre')).toBeNull();
    expect(screen.queryByText(DOC_NOT_UTF8_NOTE)).toBeNull();
    expect(screen.getByText('Download')).toBeTruthy();
  }, 60000);

  it('source parts: the sentence naming the parts gives the size of the read, not of the decoded text (a BOM is not counted)', async () => {
    // 3 MiB read, a BOM first: the decoded text is 3 MiB less 3 bytes, which the sentence would round up to 3.1 MiB.
    const size = 3 * 1048576;
    const src = new Uint8Array(size).fill(0x7a);
    src.set([0xef, 0xbb, 0xbf]);
    openLeaf('/docs/demo/specs/one.log?ref=main', statDraft('one.log', size), src);
    await waitFor(() => expect(screen.getByText('Part 1 of 2')).toBeTruthy(), { timeout: 20000 });
    expect(screen.getByText(fillSentence(DOCS_RANGE_TEXT.sourceParts, { size: '3 MiB', part: '2 MiB' }))).toBeTruthy();
  }, 60000);
});

describe('RangeSource: one document at a time', () => {
  const read = (fill: number, digest: string): RangeBytes => ({
    bytes: new Uint8Array(DOCS_MAX_DOC_BYTES + 10).fill(fill) as Uint8Array<ArrayBuffer>, digest,
  });

  it('source parts: after moving to part 2, another document (another digest) starts at part 1', () => {
    const { rerender } = render(<RangeSource read={read(0x61, 'a'.repeat(64))} path="specs/a.log" />);
    expect(screen.getByText('Part 1 of 2')).toBeTruthy();
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.partNext));
    expect(screen.getByText('Part 2 of 2')).toBeTruthy();
    rerender(<RangeSource read={read(0x62, 'b'.repeat(64))} path="specs/b.log" />);
    expect(screen.getByText('Part 1 of 2')).toBeTruthy();
    expect(document.querySelector('pre.doc-plain')?.textContent?.startsWith('bbbb')).toBe(true);
  }, 60000);

  it('source parts: a part is shown, and published for Export, from its own text alone, with no whole-file digest on it', () => {
    const digest = 'd1'.repeat(32);
    const published: ExportBody[] = [];
    const publish = (b: ExportBody | null): void => { if (b !== null) published.push(b); };
    render(
      <ExportBodyContext value={publish}>
        <RangeSource read={read(0x61, digest)} path="specs/a.log" />
      </ExportBodyContext>,
    );
    const part1 = 'a'.repeat(DOCS_MAX_DOC_BYTES);
    const shown = (): string => document.querySelector('pre.doc-plain')?.textContent ?? '';
    expect(shown(), 'part 1 is the first 2 MiB of the file, no more').toBe(part1);
    expect(published.at(-1), 'and the Export body is that text alone').toEqual({ kind: 'text', text: part1, lang: null });
    fireEvent.click(screen.getByText(DOCS_RANGE_TEXT.partNext));
    expect(shown(), 'part 2 is the rest').toBe('a'.repeat(10));
    expect(published.at(-1)).toEqual({ kind: 'text', text: 'a'.repeat(10), lang: null });
    for (const b of published) expect(Object.keys(b).sort(), 'a body carries kind, lang and text only').toEqual(['kind', 'lang', 'text']);
    expect(document.body.innerHTML, 'no digest on the page').not.toContain(digest);
  }, 60000);
});
