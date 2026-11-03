// The block highlight cap (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10's "Highlighting" and
// section 4.15's M4.H1, the W4 plan's refinement (l)). `CodeBlock` asks highlight.js to colour a block only when its
// language is registered, its `highlight` prop is not `false`, and it is at most `MD_HIGHLIGHT_BLOCK_MAX_CHARS`
// characters after the trailing-newline strip. A registered block over the cap renders as plain text and labels
// itself "{label} · not highlighted ({KiB} KiB)", KiB being its characters / 1024 rounded up. (Not
// `code-block.test.tsx`: open PR #111 creates that file.)
// From W5h-a the cap is `highlightStore.ts#blockKey`'s and the colours the highlight worker's; the cases render under a synchronous test store, and one runs the real store (M4.H1 re-proved through the store).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { defaultUrlTransform } from 'react-markdown';
import { CHAT_COMPONENTS, CodeBlock, PreHighlightContext } from '../src/lib/markdown';
import { HLJS } from '../src/lib/highlightGrammars';
import { createProductionStore } from '../src/lib/highlighterContext';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';
import { inThreadHighlighter, syncTestStore, withSyncStore } from './highlightTestStore';

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
function block(lang: string, body: string): HTMLElement {
  return render(withSyncStore(
    <CodeBlock>
      <code className={`language-${lang}`}>{`${body}\n`}</code>
    </CodeBlock>,
  )).container;
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

  // From W5h-a the shipped per-block HTML cap (MD_HIGHLIGHT_MAX_HTML_CHARS) keeps a 65 536-character python block of
  // keyword lines plain, whatever the block cap admits: its markup is over that cap. The two cases below keep what
  // part 1's cap decides (the block is admitted, its key is requestable, and it is requested) and then assert what
  // ships (plain, labelled "output too large") until W5h-b.
  it('the cap is inclusive: 65 536 characters are admitted and requested, and stay plain over the HTML cap until W5h-b; 65 537 are not requested', () => {
    expect(MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(65536);
    const atBody = pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    const store = syncTestStore('chat');
    const at = render(withSyncStore(<CodeBlock><code className="language-python">{`${atBody}\n`}</code></CodeBlock>, store)).container;
    const key = store.keyOf('python', atBody);
    expect(key.kind).toBe('key');
    expect(store.requests).toHaveLength(1);
    expect(store.requests[0] === (key.kind === 'key' ? key.key : null)).toBe(true);
    expect(HLJS.highlight(atBody, { language: 'python', ignoreIllegals: true }).value.length).toBeGreaterThan(MD_HIGHLIGHT_MAX_HTML_CHARS);
    expect(keywords(at)).toBe(0);
    expect(label(at)).toBe('Python · not highlighted (output too large)');
    cleanup();
    const overStore = syncTestStore('chat');
    const over = render(withSyncStore(<CodeBlock><code className="language-python">{`${pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1)}\n`}</code></CodeBlock>, overStore)).container;
    expect(overStore.keyOf('python', pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1)).kind).toBe('over-cap');
    expect(overStore.requests).toEqual([]);
    expect(keywords(over)).toBe(0);
    expect(label(over)).toBe('Python · not highlighted (65 KiB)');
  });

  it('counts the block after the trailing-newline strip, as the copy button does: admitted and requested, plain over the HTML cap until W5h-b', () => {
    // pyBody(65 536) plus the newline the block appends is 65 537 characters before the strip.
    const body = pyBody(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    const store = syncTestStore('chat');
    const c = render(withSyncStore(<CodeBlock><code className="language-python">{`${body}\n`}</code></CodeBlock>, store)).container;
    const key = store.keyOf('python', body);
    expect(key.kind).toBe('key');
    expect(store.requests).toHaveLength(1);
    expect(store.requests[0] === (key.kind === 'key' ? key.key : null)).toBe(true);
    expect(label(c)).toBe('Python · not highlighted (output too large)');
    expect(code(c)).toBe(body);
  });

  it('a 70 000-char block from the parse pipeline is capped too', () => {
    const outcome = parseMarkdown('```ts\n' + tsBody(70000) + '\n```');
    if (outcome.kind !== 'tree') throw new Error(`expected a tree, got ${outcome.kind}`);
    const c = render(withSyncStore(renderHast(outcome.tree, { components: CHAT_COMPONENTS, urlTransform: defaultUrlTransform })))
      .container;
    expect(keywords(c)).toBe(0);
    expect(label(c)).toBe('TypeScript · not highlighted (69 KiB)');
  });

  it('an unregistered language is unchanged by the cap: no spans either way, its own label', () => {
    const big = block('mermaid', tsBody(70000));
    expect(keywords(big)).toBe(0);
    expect(label(big)).toBe('mermaid');
    cleanup();
    expect(label(block('mermaid', tsBody(1000)))).toBe('mermaid');
  });
});
describe('M4.H1 through the real store: a block over the cap is never posted', () => {
  it('a 70 000-character python block makes no request and says its size; a 1 000-character one is requested', async () => {
    const h = inThreadHighlighter();
    const store = createProductionStore(h, 'chat');
    const big = render(<PreHighlightContext value={store}><CodeBlock><code className="language-python">{pyBody(70000)}</code></CodeBlock></PreHighlightContext>);
    expect(big.container.querySelector('.code-block-lang')?.textContent).toBe('Python · not highlighted (69 KiB)');
    expect(h.calls).toHaveLength(0);
    const small = render(<PreHighlightContext value={store}><CodeBlock><code className="language-python">{pyBody(1000)}</code></CodeBlock></PreHighlightContext>);
    await waitFor(() => expect(small.container.querySelector('.hljs-keyword')).not.toBeNull());
    expect(h.calls.map((c) => c.code.length)).toEqual([1000]);
  });
});

describe('L1-2: a fence named for an Object.prototype key labels itself and draws plain', () => {
  it.each(['__proto__', 'constructor'])('a ```%s fence renders its code plain under its own name, with no throw', (lang) => {
    const c = block(lang, 'x');
    expect(label(c)).toBe(lang);
    expect(code(c)).toBe('x');
    expect(c.querySelector('[class^="hljs-"]')).toBeNull();
  });
});
