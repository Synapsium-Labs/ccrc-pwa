// The block highlight cap (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10's "Highlighting" and
// section 4.15's M4.H1, the W4 plan's refinement (l)). `CodeBlock` asks highlight.js to colour a block only when its
// language is registered, its `highlight` prop is not `false`, and it is at most `MD_HIGHLIGHT_BLOCK_MAX_CHARS`
// characters after the trailing-newline strip. A registered block over the cap renders as plain text and labels
// itself "{label} · not highlighted ({KiB} KiB)", KiB being its characters / 1024 rounded up. (Not
// `code-block.test.tsx`: open PR #111 creates that file.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { defaultUrlTransform } from 'react-markdown';
import hljs from 'highlight.js/lib/core';
import {
  CHAT_COMPONENTS, CodeBlock, HIGHLIGHT_CACHE_MAX_CHARS, HIGHLIGHT_CACHE_MAX_ENTRIES, boundedHighlight,
} from '../src/lib/markdown';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** A TypeScript body of exactly `chars` characters, every line a keyword, ending in `x` (never a newline, which
 *  the strip would take). */
const tsBody = (chars: number): string => 'const a = 1;\n'.repeat(Math.ceil(chars / 13)).slice(0, chars - 1) + 'x';

/** A Python body of exactly `chars` characters, every line a keyword, ending in `x`: Python keeps the 64 KiB cap that
 *  `ts` no longer has (review 450 F1: `typescript` is capped at 8 192 characters), so it measures the general cap. */
const pyBody = (chars: number): string => 'import a\n'.repeat(Math.ceil(chars / 9)).slice(0, chars - 1) + 'x';

/** One fenced block, as react-markdown hands it to the `pre` component. */
function block(lang: string, body: string, highlight?: boolean): HTMLElement {
  return render(
    <CodeBlock highlight={highlight}>
      <code className={`language-${lang}`}>{`${body}\n`}</code>
    </CodeBlock>,
  ).container;
}

const keywords = (c: HTMLElement): number => c.querySelectorAll('.hljs-keyword').length;
const label = (c: HTMLElement): string | null | undefined => c.querySelector('.code-block-lang')?.textContent;
const code = (c: HTMLElement): string | null | undefined => c.querySelector('pre > code.hljs')?.textContent;

describe('M4.H1: the block highlight cap', () => {
  it('a 70 000-char ts block has no .hljs-keyword and says it is not highlighted', () => {
    const body = tsBody(70000);
    const c = block('ts', body);
    expect(keywords(c)).toBe(0);
    expect(label(c)).toBe('TypeScript · not highlighted (69 KiB)');
    expect(code(c)).toBe(body);
  });

  it('a 1 000-char ts block has keyword spans and its plain label', () => {
    const c = block('ts', tsBody(1000));
    expect(keywords(c)).toBeGreaterThan(0);
    expect(label(c)).toBe('TypeScript');
  });

  it('the cap is inclusive: 65 536 characters are highlighted, 65 537 are not', () => {
    expect(MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(65536);
    const at = block('python', pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS));
    expect(keywords(at)).toBeGreaterThan(0);
    expect(label(at)).toBe('Python');
    cleanup();
    const over = block('python', pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1));
    expect(keywords(over)).toBe(0);
    expect(label(over)).toBe('Python · not highlighted (65 KiB)');
  });

  it('counts the block after the trailing-newline strip, as the copy button does', () => {
    // pyBody(65 536) plus the newline `block` appends is 65 537 characters before the strip.
    expect(keywords(block('python', pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS)))).toBeGreaterThan(0);
  });

  it('a 70 000-char block from the parse pipeline is capped too', () => {
    const outcome = parseMarkdown('```ts\n' + tsBody(70000) + '\n```');
    if (outcome.kind !== 'tree') throw new Error(`expected a tree, got ${outcome.kind}`);
    const c = render(renderHast(outcome.tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform }))
      .container;
    expect(keywords(c)).toBe(0);
    expect(label(c)).toBe('TypeScript · not highlighted (69 KiB)');
  });
});

describe('the highlight prop and the other two conditions', () => {
  it('highlight={false} renders a small registered block as plain <code class="hljs"> with its plain label', () => {
    const body = tsBody(1000);
    const c = block('ts', body, false);
    expect(keywords(c)).toBe(0);
    expect(c.querySelector('pre > code.hljs')?.children).toHaveLength(0);
    expect(code(c)).toBe(body);
    expect(label(c)).toBe('TypeScript');
  });

  it('highlight={true} is the default', () => {
    expect(keywords(block('ts', tsBody(1000), true))).toBeGreaterThan(0);
  });

  it('an unregistered language is unchanged by the cap: no spans either way, its own label', () => {
    const big = block('mermaid', tsBody(70000));
    expect(keywords(big)).toBe(0);
    expect(label(big)).toBe('mermaid');
    cleanup();
    expect(label(block('mermaid', tsBody(1000)))).toBe('mermaid');
  });
});

// Desktop polish Task C7: `boundedHighlight` keeps what highlight.js answered in a bounded module cache keyed by the
// language and the block, read only after every bound has passed. The module's cache outlives a case, so each case
// highlights text no other case does.
describe('the highlight cache (C7)', () => {
  it('hljs.highlight runs once per (lang, code)', () => {
    const spy = vi.spyOn(hljs, 'highlight');
    const body = `${tsBody(400)} // once-per-pair`;
    const first = block('ts', body);
    expect(keywords(first)).toBeGreaterThan(0);
    const html = first.querySelector('pre > code.hljs')?.innerHTML;
    cleanup();
    const second = block('ts', body);
    expect(spy).toHaveBeenCalledTimes(1);
    // The same markup, from the cache.
    expect(second.querySelector('pre > code.hljs')?.innerHTML).toBe(html);
    cleanup();
    // Another language is another pair, even over the same text.
    block('javascript', body);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a block the bounds refuse is highlighted never and cached never', () => {
    const spy = vi.spyOn(hljs, 'highlight');
    // Over the word bound: plain, labelled, and highlight.js is never asked, however often it renders.
    const long = `const ${'w'.repeat(MD_HIGHLIGHT_MAX_WORD_CHARS + 1)} = 1;`;
    for (let i = 0; i < 2; i += 1) {
      const c = block('ts', long);
      expect(keywords(c)).toBe(0);
      expect(label(c)).toBe(`TypeScript · not highlighted (a ${MD_HIGHLIGHT_MAX_WORD_CHARS + 1}-character word)`);
      cleanup();
    }
    expect(spy).not.toHaveBeenCalled();
    // A pair already in the cache, then refused by a page budget (`highlight={false}`): the refusal is decided before
    // the cache is read, so the block renders plain and nothing is highlighted again.
    const body = `${tsBody(300)} // cached-then-refused`;
    expect(keywords(block('ts', body))).toBeGreaterThan(0);
    cleanup();
    expect(spy).toHaveBeenCalledTimes(1);
    const refused = block('ts', body, false);
    expect(keywords(refused)).toBe(0);
    expect(code(refused)).toBe(body);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it(`the cache holds at most ${HIGHLIGHT_CACHE_MAX_ENTRIES} entries and ${HIGHLIGHT_CACHE_MAX_CHARS} characters of markup`, () => {
    expect(HIGHLIGHT_CACHE_MAX_ENTRIES).toBe(256);
    expect(HIGHLIGHT_CACHE_MAX_CHARS).toBe(4_000_000);
    const spy = vi.spyOn(hljs, 'highlight');
    // The entry bound: one more small block than it holds pushes the first out, so the first is highlighted again.
    const small = (i: number): string => `const entry${i} = ${i}; // entry-bound`;
    for (let i = 0; i <= HIGHLIGHT_CACHE_MAX_ENTRIES; i += 1) boundedHighlight(small(i), 'ts');
    expect(spy).toHaveBeenCalledTimes(HIGHLIGHT_CACHE_MAX_ENTRIES + 1);
    boundedHighlight(small(HIGHLIGHT_CACHE_MAX_ENTRIES), 'ts'); // the newest is still held
    expect(spy).toHaveBeenCalledTimes(HIGHLIGHT_CACHE_MAX_ENTRIES + 1);
    boundedHighlight(small(0), 'ts');
    expect(spy).toHaveBeenCalledTimes(HIGHLIGHT_CACHE_MAX_ENTRIES + 2);
    // The weight bound: a few dense JSON blocks whose markup together passes the character bound push the first out
    // long before the entry bound is reached.
    const dense = (i: number): string =>
      JSON.stringify(Array.from({ length: 3000 }, (_, k) => [i, k, true, null]), null, 1).slice(0, MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    spy.mockClear();
    let markup = 0;
    let n = 0;
    while (markup <= HIGHLIGHT_CACHE_MAX_CHARS) {
      const h = boundedHighlight(dense(n), 'json');
      expect(h.html).not.toBeNull();
      markup += h.html!.length;
      n += 1;
    }
    expect(n).toBeLessThan(HIGHLIGHT_CACHE_MAX_ENTRIES);
    expect(spy).toHaveBeenCalledTimes(n);
    boundedHighlight(dense(n - 1), 'json'); // the newest is still held
    expect(spy).toHaveBeenCalledTimes(n);
    boundedHighlight(dense(0), 'json');
    expect(spy).toHaveBeenCalledTimes(n + 1);
  });
});
