// The block highlight cap (native Docs reader, W4 Task 4; design 2026-10-01 section 4.10's "Highlighting" and
// section 4.15's M4.H1, the W4 plan's refinement (l)). `CodeBlock` asks highlight.js to colour a block only when its
// language is registered, its `highlight` prop is not `false`, and it is at most `MD_HIGHLIGHT_BLOCK_MAX_CHARS`
// characters after the trailing-newline strip. A registered block over the cap renders as plain text and labels
// itself "{label} · not highlighted ({KiB} KiB)", KiB being its characters / 1024 rounded up. (Not
// `code-block.test.tsx`: open PR #111 creates that file.)
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { defaultUrlTransform } from 'react-markdown';
import { CHAT_COMPONENTS, CodeBlock } from '../src/lib/markdown';
import { MD_HIGHLIGHT_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';
import { parseMarkdown } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';

afterEach(cleanup);

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
