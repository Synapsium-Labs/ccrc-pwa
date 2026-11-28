// The reader's render job, as the worker answers it (native Docs reader, W8a Task 4; the rich-docs spec's (amended 2026-10-31) A6 and M8.21). The
// cases call `answerRenderJob` directly and collect its posts, as `markdown-parse.test.ts` does for
// `answerMarkdownJob`; the lazy chunk and the runner's side are `markdown-purity`, `markdown-runner` and
// `markdown-worker-built`. The library's own outcome words are asserted here as the job reports them.
import { render } from '@synapsium-labs/pinax-lib/render';
import { describe, expect, it, vi } from 'vitest';
import { DOCS_RENDER_GATE_BYTES, MD_MAX_DELIMITER_RUN } from '../src/lib/markdownLimits';
import { READER_BLOCKS_HTML_MAX_BYTES, READER_BLOCKS_MAX_BYTES, READER_HTML_MAX_BYTES } from '../src/lib/readerLimits';
import { printAllow } from '../src/lib/printAllow';
import { answerRenderJob, type ReaderRenderReply } from '../src/lib/readerRenderJob';
import { parseRendered } from '../src/lib/renderTree';

/** When set, the html parse of the render output throws (the print job's one new failure). */
let parseThrows = false;
vi.mock('../src/lib/renderTree', async (importOriginal) => {
  const lib = await importOriginal<typeof import('../src/lib/renderTree')>();
  return { ...lib, parseRendered: ((html: string) => { if (parseThrows) throw new RangeError('x'); return lib.parseRendered(html); }) as typeof lib.parseRendered };
});

/** The options each `render()` call of the library received, in order (the library itself still renders). */
const renderCalls: unknown[] = [];
vi.mock('@synapsium-labs/pinax-lib/render', async (importOriginal) => {
  const lib = await importOriginal<typeof import('@synapsium-labs/pinax-lib/render')>();
  return { ...lib, render: ((src: string, o: unknown) => { renderCalls.push(o); return lib.render(src, o as never); }) as typeof lib.render };
});

/** What `answerRenderJob` posts for `data`. */
function posts(data: unknown): ReaderRenderReply[] {
  const out: ReaderRenderReply[] = [];
  answerRenderJob(data, (r) => { out.push(r); });
  return out;
}

const bytes = (s: string): number => new TextEncoder().encode(s).byteLength;

describe('answerRenderJob', () => {
  it('a small doc answers rendered with html, meta, the mermaid counts and its image refs', () => {
    const src = '# T\n\n![a](a.png)\n\n```mermaid\nflowchart LR\n  A-->B\n```\n';
    const out = posts({ id: 1, kind: 'render', src });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(1);
    const outcome = out[0]!.outcome;
    if (outcome.kind !== 'rendered') throw new Error(`expected rendered, got ${outcome.kind}`);
    expect(outcome.result.outcome).toBe('rendered');
    expect(outcome.result.html).toContain('data-line=');
    expect(outcome.result.meta.title).toBe('T');
    expect(outcome.mermaid.fences).toBe(1);
    expect(outcome.images).toEqual(['a.png']);
    expect(outcome.imagesTruncated).toBe(false);
  });

  it('render job: the outcome carries the library\'s reading time', () => {
    // About 460 words of prose is two minutes by the byline's rule (230 a minute): finite, and at least one.
    const prose = posts({ id: 7, kind: 'render', src: `# T\n\n${'word '.repeat(460)}\n` })[0]!.outcome;
    if (prose.kind !== 'rendered') throw new Error(`expected rendered, got ${prose.kind}`);
    const minutes = prose.result.meta.readingMinutes;
    expect(typeof minutes, 'the reading time was dropped from the meta').toBe('number');
    expect(Number.isFinite(minutes)).toBe(true);
    expect(minutes as number).toBeGreaterThanOrEqual(1);
    // A document with no text has none: the library says 0, and the job carries it as it is (the overlay shows the percentage alone).
    const empty = posts({ id: 8, kind: 'render', src: '' })[0]!.outcome;
    if (empty.kind !== 'rendered') throw new Error(`expected rendered, got ${empty.kind}`);
    expect(empty.result.meta.readingMinutes).toBe(0);
  });

  it('a delimiter run the pre-scan refuses answers refused, before render runs', () => {
    const src = `a ${String.fromCharCode(42).repeat(MD_MAX_DELIMITER_RUN + 1)} b`;
    const out = posts({ id: 2, kind: 'render', src });
    expect(out).toHaveLength(1);
    expect(out[0]!.outcome.kind).toBe('refused');
    expect(out[0]!.outcome).toMatchObject({ kind: 'refused', why: 'delimiter-run' });
  });

  it('html past READER_HTML_MAX_BYTES answers not-rendered output-over-limit', () => {
    // One-character paragraphs: each draws a `<p data-line="a-b">` wrapper, so the html is several times the source.
    const para = 'a\n\n';
    const src = para.repeat(Math.floor(DOCS_RENDER_GATE_BYTES / bytes(para)));
    expect(bytes(src)).toBeLessThanOrEqual(DOCS_RENDER_GATE_BYTES);
    const out = posts({ id: 3, kind: 'render', src });
    expect(out).toEqual([{ id: 3, outcome: { kind: 'not-rendered', why: 'output-over-limit' } }]);
  });

  it('a source over the render gate answers not-rendered over-limit', () => {
    const src = 'a'.repeat(DOCS_RENDER_GATE_BYTES + 1);
    expect(posts({ id: 4, kind: 'render', src }))
      .toEqual([{ id: 4, outcome: { kind: 'not-rendered', why: 'over-limit' } }]);
  });

  it('a non-string src answers threw TypeError', () => {
    expect(posts({ id: 5, kind: 'render', src: 7 }))
      .toEqual([{ id: 5, outcome: { kind: 'threw', error: 'TypeError' } }]);
  });

  it('a message with no numeric id gets no answer', () => {
    expect(posts({ kind: 'render', src: 'x' })).toEqual([]);
    expect(posts({ id: 'a', kind: 'render', src: 'x' })).toEqual([]);
  });

  it('render job: blocks answers the library\'s top-level blocks, highlight off, under its own caps', () => {
    const src = '# T\n\nlead\n\n- a\n- b\n  ```ts\n  x\n  ```\n\n```js\ny\n```\n';
    renderCalls.length = 0;
    const out = posts({ id: 20, kind: 'render', src, blocks: true });
    expect(out).toEqual([{ id: 20, outcome: { kind: 'blocks', blocks: [
      { from: 0, to: 1, kind: 'heading' },
      { from: 2, to: 3, kind: 'other' },
      { from: 4, to: 10, kind: 'list', items: [
        { from: 4, to: 5, kind: 'other' },
        { from: 5, to: 10, kind: 'other', items: [{ from: 6, to: 9, kind: 'fence' }] },
      ] },
      { from: 10, to: 13, kind: 'fence' },
    ] } }]);
    // The library is asked once, with its own caps and no highlighting (a block read needs no colour).
    expect(renderCalls).toEqual([{ maxBytes: READER_BLOCKS_MAX_BYTES, maxHtmlBytes: READER_BLOCKS_HTML_MAX_BYTES, highlight: false }]);
    expect(READER_BLOCKS_MAX_BYTES).toBe(2097152);
    expect(READER_BLOCKS_HTML_MAX_BYTES).toBe(10485760);
    // A window of READER_BLOCKS_MAX_BYTES of tables draws the most html of the shapes measured (4.4 times its size, a list 3.4):
    // the cap covers it, so a window the cutter grew to is never refused for its html.
    const rows = (i: number): string => `| ${i} | x |\n`;
    const table = '| a | b |\n|---|---|\n' + Array.from({ length: 6000 }, (_, i) => rows(i)).join('');
    const probe = render(table, { highlight: false });
    if (probe.outcome !== 'rendered') throw new Error('fixture');
    const ratio = bytes(probe.html) / bytes(table);
    expect(ratio, 'a table draws more than four times its size, so 8 MiB was too small for 2 MiB of one').toBeGreaterThan(4);
    expect(ratio * READER_BLOCKS_MAX_BYTES, 'and the cap covers a window of them').toBeLessThanOrEqual(READER_BLOCKS_HTML_MAX_BYTES);
    // The pre-scan runs first, and refuses as it does for a render.
    const bad = `a ${String.fromCharCode(42).repeat(MD_MAX_DELIMITER_RUN + 1)} b`;
    expect(posts({ id: 21, kind: 'render', src: bad, blocks: true })[0]!.outcome).toMatchObject({ kind: 'refused', why: 'delimiter-run' });
    // Its own cap: a source of up to READER_BLOCKS_MAX_BYTES is read where a render stops at the gate, and one byte past it is over.
    const big = 'lorem ipsum dolor sit amet, consectetur adipiscing elit\n\n'.repeat(Math.ceil((DOCS_RENDER_GATE_BYTES + 1) / 56));
    expect(bytes(big)).toBeGreaterThan(DOCS_RENDER_GATE_BYTES);
    expect(posts({ id: 22, kind: 'render', src: big })[0]!.outcome).toEqual({ kind: 'not-rendered', why: 'over-limit' });
    const read = posts({ id: 23, kind: 'render', src: big, blocks: true })[0]!.outcome;
    expect(read.kind).toBe('blocks');
    expect(posts({ id: 24, kind: 'render', src: 'a'.repeat(READER_BLOCKS_MAX_BYTES + 1), blocks: true }))
      .toEqual([{ id: 24, outcome: { kind: 'not-rendered', why: 'over-limit' } }]);
    // Its own html cap (8 MiB; asserted above in the options): html past it is output-over-limit, and the html is never parsed.
    // (One-character paragraphs are the shape; measured on the dev box, the parser took 8 to 22 s on the html of 130 000 of them,
    // 4.4 MB, which the runner's budget answers `timeout`, so this case stops at the cap instead of reading a window under it.)
    const denser = 'a\n\n'.repeat(Math.floor(READER_BLOCKS_MAX_BYTES / 3));
    expect(posts({ id: 27, kind: 'render', src: denser, blocks: true }))
      .toEqual([{ id: 27, outcome: { kind: 'not-rendered', why: 'output-over-limit' } }]);
  });

  it('render job: a job without blocks is answered as before', () => {
    const src = '# T\n\ntext ![a](a.png)\n\n```mermaid\nflowchart LR\n  A-->B\n```\n';
    const exact = {
      kind: 'rendered',
      result: {
        outcome: 'rendered',
        html: '<h1 id="t" data-line="1-1">T</h1>\n<p data-line="3-3">text <img src="a.png" alt="a" /></p>\n'
          + '<figure class="mermaid-figure" data-line="5-8"><pre class="mermaid">flowchart LR\n  A--&gt;B\n</pre></figure>\n',
        meta: { title: 'T', frontList: null, headings: [{ level: 1, id: 't', text: 'T' }], figures: 1, mermaidKinds: ['flowchart'], readingMinutes: 0.508695652173913 },
      },
      mermaid: { fences: 1, largestBytes: 21, totalBytes: 21, largestChars: 21, totalChars: 21 },
      images: ['a.png'],
      imagesTruncated: false,
    };
    renderCalls.length = 0;
    expect(posts({ id: 30, kind: 'render', src })).toEqual([{ id: 30, outcome: exact }]);
    // The render's options are exactly the gate and the html cap of old: no highlight key, no blocks.
    expect(renderCalls).toEqual([{ maxBytes: DOCS_RENDER_GATE_BYTES, maxHtmlBytes: READER_HTML_MAX_BYTES }]);
    // Only `true` asks for blocks.
    for (const blocks of [false, 1, 'true', undefined, null]) {
      expect(posts({ id: 31, kind: 'render', src, blocks })).toEqual([{ id: 31, outcome: exact }]);
    }
  });

  it('render job: print answers the print tree from the same render', () => {
    const src = '# T\n\ntext ![a](a.png) [x](https://other.example/y) [up](#t)\n\n```mermaid\nflowchart LR\n  A-->B\n```\n';
    renderCalls.length = 0;
    const plain = posts({ id: 40, kind: 'render', src })[0]!.outcome;
    const plainCalls = [...renderCalls];
    renderCalls.length = 0;
    const out = posts({ id: 41, kind: 'render', src, print: true });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe(41);
    const outcome = out[0]!.outcome;
    if (outcome.kind !== 'rendered' || plain.kind !== 'rendered') throw new Error(`expected rendered, got ${outcome.kind}`);
    // One render path: the same render call, and the answer is the reader's own answer with the tree beside it.
    expect(renderCalls).toEqual(plainCalls);
    expect(renderCalls).toHaveLength(1);
    const { printTree, ...rest } = outcome;
    expect(rest).toEqual(plain);
    expect(printTree).toEqual(printAllow(parseRendered(outcome.result.html)));
    const first = printTree!.nodes[0]!;
    expect(first).toMatchObject({ t: 'el', n: 'h1', a: { id: 'docs-print-t' } });
    // The tree is plain data: it survives a structured clone untouched.
    expect(structuredClone(printTree)).toEqual(printTree);
  });

  it('render job: a refusal or a render that did not render answers as for any job, with no print tree', () => {
    const bad = `${'*'.repeat(MD_MAX_DELIMITER_RUN + 1)}x`;
    expect(posts({ id: 42, kind: 'render', src: bad, print: true })[0]!.outcome).toMatchObject({ kind: 'refused', why: 'delimiter-run' });
    expect(posts({ id: 43, kind: 'render', src: 'a'.repeat(DOCS_RENDER_GATE_BYTES + 1), print: true }))
      .toEqual([{ id: 43, outcome: { kind: 'not-rendered', why: 'over-limit' } }]);
    expect(posts({ id: 44, kind: 'render', src: 'x', print: true })[0]!.outcome.kind).toBe('rendered');
  });

  it('render job: a print parse that throws answers threw, as any throw does', () => {
    parseThrows = true;
    try {
      expect(posts({ id: 45, kind: 'render', src: '# T', print: true })).toEqual([{ id: 45, outcome: { kind: 'threw', error: 'RangeError' } }]);
    } finally {
      parseThrows = false;
    }
  });

  it('render job: a job without print is answered as before', () => {
    const src = '# T\n\ntext ![a](a.png)\n';
    const exact = {
      kind: 'rendered',
      result: {
        outcome: 'rendered',
        html: '<h1 id="t" data-line="1-1">T</h1>\n<p data-line="3-3">text <img src="a.png" alt="a" /></p>\n',
        meta: { title: 'T', frontList: null, headings: [{ level: 1, id: 't', text: 'T' }], figures: 0, mermaidKinds: [], readingMinutes: expect.any(Number) },
      },
      mermaid: expect.anything(),
      images: ['a.png'],
      imagesTruncated: false,
    };
    renderCalls.length = 0;
    const first = posts({ id: 46, kind: 'render', src })[0]!.outcome;
    expect(first).toEqual(exact);
    expect(Object.keys(first)).not.toContain('printTree');
    // Only `true` asks for the tree.
    for (const print of [false, 1, 'true', undefined, null]) {
      const o = posts({ id: 47, kind: 'render', src, print })[0]!.outcome;
      expect(o).toEqual(exact);
      expect(Object.keys(o)).not.toContain('printTree');
    }
    expect(renderCalls.every((c) => JSON.stringify(c) === JSON.stringify({ maxBytes: DOCS_RENDER_GATE_BYTES, maxHtmlBytes: READER_HTML_MAX_BYTES }))).toBe(true);
    // A blocks job is a blocks job, print or not.
    expect(posts({ id: 48, kind: 'render', src, blocks: true, print: true })[0]!.outcome.kind).toBe('blocks');
  });

  it('a post that throws is answered once more with threw', () => {
    const seen: ReaderRenderReply[] = [];
    let calls = 0;
    answerRenderJob({ id: 6, kind: 'render', src: 'x' }, (r) => {
      calls += 1;
      if (calls === 1) throw new DOMException('x', 'DataCloneError');
      seen.push(r);
    });
    expect(seen).toEqual([{ id: 6, outcome: { kind: 'threw', error: 'DataCloneError' } }]);
    // A throwing second post is swallowed.
    expect(() => answerRenderJob({ id: 7, kind: 'render', src: 'x' }, () => { throw new Error('no'); })).not.toThrow();
  });
});
