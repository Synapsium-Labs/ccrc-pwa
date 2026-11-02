// The highlight worker's job (native Docs reader, W5h-a Task 3; base spec 2026-10-01 section 4.10's "The job and its
// outcome", "The worker-side cache" and "The line retry"; M4.H13, M4.H18 and M4.H20, worker halves). Each case calls
// `createHighlightAnswerer` in-thread, over the worker's own instance (`HLJS`) or a counting fake, and collects what
// it posts. The built chunk's own run, with no DOM, is `markdown-worker-built.test.ts`'s (M7.11).
import { describe, expect, it } from 'vitest';
import { createLru } from '../src/lib/highlightCache';
import { HLJS } from '../src/lib/highlightGrammars';
import { createHighlightAnswerer, type HighlightInstance } from '../src/lib/highlightJob';
import type { HighlightReply } from '../src/lib/highlightProtocol';
import {
  HIGHLIGHT_CACHE_MAX_CHARS, HIGHLIGHT_CACHE_MAX_ENTRIES, HIGHLIGHT_LINE_RETRY_UNITS, MD_HIGHLIGHT_MAX_HTML_CHARS,
} from '../src/lib/markdownLimits';

type Answer = ReturnType<typeof createHighlightAnswerer>;
/** Every post one message makes. */
function posts(answer: Answer, job: unknown): HighlightReply[] {
  const out: HighlightReply[] = [];
  answer(job, (r) => { out.push(r); });
  return out;
}

/** A fake instance that knows `ts` only, answers `html(code)` (default: the code in one `hljs-x` span), and records
 *  every code it is asked to colour. */
function fake(html: (code: string) => string = (c) => `<span class="hljs-x">${c}</span>`): { h: HighlightInstance; calls: string[] } {
  const calls: string[] = [];
  const h = {
    getLanguage: (name: string) => (name === 'ts' ? {} : undefined),
    highlight: (code: string) => { calls.push(code); return { value: html(code) }; },
  } as unknown as HighlightInstance;
  return { h, calls };
}

/** `n` distinct lines of `width` characters, the last with no break after it. */
const lines = (n: number, width: number): string[] =>
  Array.from({ length: n }, (_, i) => String(i).padStart(width, 'a'));

describe('the job: one block, one call, one answer', () => {
  it('a registered block answers html in block mode, with the instance\'s spans', () => {
    expect(posts(createHighlightAnswerer(), { id: 1, lang: 'typescript', code: 'const a = 1;' })).toEqual([
      { id: 1, result: { kind: 'html', mode: 'block', html: expect.stringContaining('<span class="hljs-keyword">const</span>') } },
    ]);
  });

  it('an unknown or empty language answers unregistered, and nothing is coloured', () => {
    const f = fake();
    const answer = createHighlightAnswerer(f.h);
    expect(posts(answer, { id: 2, lang: 'nope', code: 'x' })).toEqual([{ id: 2, result: { kind: 'unregistered' } }]);
    expect(posts(answer, { id: 3, lang: '', code: 'x' })).toEqual([{ id: 3, result: { kind: 'unregistered' } }]);
    expect(f.calls).toEqual([]);
  });

  it('a markdown fence holding a tag answers a language-xml span (the check\'s subLanguage form)', () => {
    const [reply] = posts(createHighlightAnswerer(), { id: 4, lang: 'markdown', code: '<b>x</b>' });
    expect(reply).toMatchObject({ id: 4, result: { kind: 'html' } });
    expect((reply as { result: { html: string } }).result.html).toContain('<span class="language-xml">');
  });

  it('a message with no finite numeric id gets no answer', () => {
    const answer = createHighlightAnswerer(fake().h);
    for (const job of [{ lang: 'ts', code: 'x' }, { id: 'a', lang: 'ts', code: 'x' }, { id: Infinity, lang: 'ts', code: 'x' }, null, 7]) {
      expect(posts(answer, job), JSON.stringify(job)).toEqual([]);
    }
  });

  it('a non-string lang or code answers threw TypeError', () => {
    const answer = createHighlightAnswerer(fake().h);
    expect(posts(answer, { id: 5, lang: 'ts', code: 7 })).toEqual([{ id: 5, result: { kind: 'threw', error: 'TypeError' } }]);
    expect(posts(answer, { id: 6, lang: 1, code: 'x' })).toEqual([{ id: 6, result: { kind: 'threw', error: 'TypeError' } }]);
  });

  it('a post that throws is answered once more with threw; a second throwing post is swallowed', () => {
    const answer = createHighlightAnswerer(fake().h);
    const seen: HighlightReply[] = [];
    answer({ id: 7, lang: 'ts', code: 'x' }, (r) => {
      seen.push(r);
      if (seen.length === 1) throw new DOMException('x', 'DataCloneError');
    });
    expect(seen[1]).toEqual({ id: 7, result: { kind: 'threw', error: 'DataCloneError' } });
    expect(() => answer({ id: 8, lang: 'ts', code: 'x' }, () => { throw new Error('again'); })).not.toThrow();
  });
});

describe('M4.H13 (worker half): the HTML cap is applied before posting', () => {
  it('HTML over MD_HIGHLIGHT_MAX_HTML_CHARS is posted as too-large with its length, never as HTML', () => {
    const answer = createHighlightAnswerer(fake(() => 'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS + 1)).h);
    expect(posts(answer, { id: 9, lang: 'ts', code: 'a' })).toEqual([
      { id: 9, result: { kind: 'too-large', htmlChars: MD_HIGHLIGHT_MAX_HTML_CHARS + 1 } },
    ]);
  });

  it('HTML of exactly MD_HIGHLIGHT_MAX_HTML_CHARS is posted', () => {
    const answer = createHighlightAnswerer(fake(() => 'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS)).h);
    expect(posts(answer, { id: 10, lang: 'ts', code: 'a' })[0]).toMatchObject({ result: { kind: 'html', mode: 'block' } });
  });
});

describe('M4.H18 (worker half): line mode under C24', () => {
  it('a block over the unit, in line mode, colours each line alone and keeps each break as written', () => {
    const f = fake();
    const parts = lines(40, 9);
    const breaks = parts.slice(1).map((_, i) => (i % 3 === 0 ? '\r\n' : i % 3 === 1 ? '\n' : '\r'));
    const code = parts.map((l, i) => l + (breaks[i] ?? '')).join('');
    expect(code.length).toBeGreaterThan(HIGHLIGHT_LINE_RETRY_UNITS);
    const [reply] = posts(createHighlightAnswerer(f.h), { id: 11, lang: 'ts', code, mode: 'line' });
    expect(f.calls).toEqual(parts);
    expect(reply).toEqual({ id: 11, result: { kind: 'html', mode: 'line',
      html: parts.map((l, i) => `<span class="hljs-x">${l}</span>${breaks[i] ?? ''}`).join('') } });
  });

  it('line mode answers line-too-long, with its length, when one line is over the unit, and colours nothing', () => {
    const f = fake();
    const code = `${'a'.repeat(HIGHLIGHT_LINE_RETRY_UNITS + 1)}\nb`;
    expect(posts(createHighlightAnswerer(f.h), { id: 12, lang: 'ts', code, mode: 'line' })).toEqual([
      { id: 12, result: { kind: 'line-too-long', chars: HIGHLIGHT_LINE_RETRY_UNITS + 1 } },
    ]);
    expect(f.calls).toEqual([]);
  });

  it('line mode on a block of at most the unit colours it whole, in block mode', () => {
    const f = fake();
    const code = 'a'.repeat(HIGHLIGHT_LINE_RETRY_UNITS - 2) + '\nb';
    expect(code).toHaveLength(HIGHLIGHT_LINE_RETRY_UNITS);
    expect(posts(createHighlightAnswerer(f.h), { id: 13, lang: 'ts', code, mode: 'line' })[0])
      .toMatchObject({ result: { kind: 'html', mode: 'block' } });
    expect(f.calls).toEqual([code]);
  });

  it('line mode still applies the HTML cap to the joined answer', () => {
    const code = lines(40, 9).join('\n');
    const answer = createHighlightAnswerer(fake(() => 'x'.repeat(Math.ceil(MD_HIGHLIGHT_MAX_HTML_CHARS / 39))).h);
    expect(posts(answer, { id: 14, lang: 'ts', code, mode: 'line' })[0]).toMatchObject({ result: { kind: 'too-large' } });
  });
});

describe('M4.H20: the worker-side LRU', () => {
  it('the same (mode, lang, code) twice calls highlight once; the other mode is its own entry', () => {
    const f = fake();
    const answer = createHighlightAnswerer(f.h);
    const code = lines(40, 9).join('\n');
    posts(answer, { id: 15, lang: 'ts', code });
    posts(answer, { id: 16, lang: 'ts', code });
    expect(f.calls).toEqual([code]);
    posts(answer, { id: 17, lang: 'ts', code, mode: 'line' });
    posts(answer, { id: 18, lang: 'ts', code, mode: 'line' });
    expect(f.calls).toHaveLength(1 + 40);
  });

  it('past the cache\'s size the least recently used entry is evicted', () => {
    const f = fake();
    const answer = createHighlightAnswerer(f.h, createLru<string>(2, 1_000_000, (s) => s.length));
    for (const code of ['a', 'b', 'c', 'a']) posts(answer, { id: 19, lang: 'ts', code });
    expect(f.calls).toEqual(['a', 'b', 'c', 'a']);
  });

  it(`the default cache holds ${HIGHLIGHT_CACHE_MAX_ENTRIES} entries and ${HIGHLIGHT_CACHE_MAX_CHARS} characters of markup`, () => {
    const byCount = fake();
    const a = createHighlightAnswerer(byCount.h);
    for (let i = 0; i <= HIGHLIGHT_CACHE_MAX_ENTRIES; i += 1) posts(a, { id: 20, lang: 'ts', code: `c${i}` });
    posts(a, { id: 21, lang: 'ts', code: 'c1' });
    posts(a, { id: 22, lang: 'ts', code: 'c0' });
    expect(byCount.calls.filter((c) => c === 'c1')).toHaveLength(1);
    expect(byCount.calls.filter((c) => c === 'c0')).toHaveLength(2);
    const heavy = Math.floor(HIGHLIGHT_CACHE_MAX_CHARS / 4) + 1;
    const byWeight = fake(() => 'x'.repeat(heavy));
    const b = createHighlightAnswerer(byWeight.h);
    for (const code of ['w0', 'w1', 'w2', 'w3', 'w0']) posts(b, { id: 23, lang: 'ts', code });
    expect(byWeight.calls).toEqual(['w0', 'w1', 'w2', 'w3', 'w0']);
  });
});

describe('the worker\'s instance strips xml\'s script and style sub-languages (kept, section 4.9)', () => {
  it('an xml block holding script and style answers no sub-language span inside them', () => {
    const [reply] = posts(createHighlightAnswerer(), { id: 24, lang: 'xml', code: '<script>var a = 1;</script><style>a { b: c }</style>' });
    const html = (reply as { result: { html: string } }).result.html;
    expect(html).not.toContain('language-javascript');
    expect(html).not.toContain('language-css');
    expect(HLJS.getLanguage('html')).toBe(HLJS.getLanguage('xml'));
  });
});
