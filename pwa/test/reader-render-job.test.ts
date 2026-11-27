// The reader's render job, as the worker answers it (native Docs reader, W8a Task 4; the rich-docs spec's (amended 2026-10-31) A6 and M8.21). The
// cases call `answerRenderJob` directly and collect its posts, as `markdown-parse.test.ts` does for
// `answerMarkdownJob`; the lazy chunk and the runner's side are `markdown-purity`, `markdown-runner` and
// `markdown-worker-built`. The library's own outcome words are asserted here as the job reports them.
import { describe, expect, it } from 'vitest';
import { DOCS_RENDER_GATE_BYTES, MD_MAX_DELIMITER_RUN } from '../src/lib/markdownLimits';
import { answerRenderJob, type ReaderRenderReply } from '../src/lib/readerRenderJob';

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
