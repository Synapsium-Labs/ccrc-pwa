// Docs W5 part 1, Task 6: the page highlight budget (spec 2026-10-01 4.10 "Highlighting"; M4.H2; refinement (h)).
// `detachUrls` sums `pre > code` text in document order and records `highlight: false` for every block from the one
// that takes the sum past `DOCS_HIGHLIGHT_PAGE_MAX_CHARS`; `SHARED_COMPONENTS.pre` reads `PreHighlightContext` with
// the `node` it is given, so a Docs page that provides the decision gives `CodeBlock` `highlight={false}` for those
// blocks, and chat, which provides nothing, is decided by the block rule alone, as before. The trees are built by
// hand, exactly as the parse emits a fenced block, so no case parses half a megabyte.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import { PreHighlightContext, SHARED_COMPONENTS } from '../src/lib/markdown';
import { DOCS_HIGHLIGHT_PAGE_MAX_CHARS, MD_HIGHLIGHT_BLOCK_MAX_CHARS } from '../src/lib/markdownLimits';
import { renderHast } from '../src/lib/renderHast';
import { DocLink } from '../src/docs/DocLink';
import { detachUrls } from '../src/docs/docsLinks';

afterEach(cleanup);

/** A fenced `ts` block as the parse emits it: `pre > code.language-ts`, holding `text`. */
const fence = (text: string): HastElement => ({
  type: 'element', tagName: 'pre', properties: {},
  children: [{ type: 'element', tagName: 'code', properties: { className: ['language-ts'] }, children: [{ type: 'text', value: text }] }],
});

/** `chars` characters of TypeScript holding exactly one keyword, then spaces broken into lines under 100 characters
 *  (a line over `MD_HIGHLIGHT_MAX_LINE_CHARS` is never highlighted), then the newline the parse keeps: cheap for
 *  highlight.js, so the case measures the decision, not the grammar. */
const body = (chars: number): string =>
  'const a = 1;' + Array.from({ length: chars - 13 }, (_, i) => ((i + 1) % 100 === 0 ? '\n' : ' ')).join('') + '\n';

const page = (sizes: readonly number[]): HastRoot => ({ type: 'root', children: sizes.map((n) => fence(body(n))) });

const pres = (root: HastRoot): HastElement[] =>
  root.children.filter((c): c is HastElement => c.type === 'element' && c.tagName === 'pre');

const BLOCK = 60000;

describe('detachUrls records each pre\'s decision in document order (spec 4.10; refinement (n))', () => {
  it('true while the running sum is within the budget, false from the block that passes it, for every later block', () => {
    const d = detachUrls(page([DOCS_HIGHLIGHT_PAGE_MAX_CHARS - 20, 20, 13, 13]));
    expect(pres(d.tree).map((p) => d.urls.get(p)?.highlight)).toEqual([true, true, false, false]);
    expect(pres(d.tree).map((p) => d.urls.get(p)?.imageIndex)).toEqual([null, null, null, null]);
  });

  it('counts only the text under the pre\'s code children', () => {
    const lead: HastElement = { type: 'element', tagName: 'pre', properties: {},
      children: [{ type: 'text', value: 'x'.repeat(DOCS_HIGHLIGHT_PAGE_MAX_CHARS + 1) }] };
    const d = detachUrls({ type: 'root', children: [lead, fence(body(13))] });
    expect(pres(d.tree).map((p) => d.urls.get(p)?.highlight)).toEqual([true, true]);
  });
});

describe('M4.H2: the page budget reaches CodeBlock through PreHighlightContext (refinement (h))', () => {
  it('the fixture: eight 60 000-character blocks fit the page budget, nine do not, and each is within the block cap', () => {
    expect(body(BLOCK)).toHaveLength(BLOCK);
    expect(8 * BLOCK).toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    expect(9 * BLOCK).toBeGreaterThan(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    expect(BLOCK).toBeLessThanOrEqual(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
  });

  const keywordsPerBlock = (c: HTMLElement): number[] =>
    [...c.querySelectorAll('.code-block')].map((b) => b.querySelectorAll('.hljs-keyword').length);

  it('nine 60 000-character ts blocks: the first eight are highlighted and the ninth is not', () => {
    const d = detachUrls(page(Array.from({ length: 9 }, () => BLOCK)));
    const { container } = render(
      <PreHighlightContext value={(pre) => d.urls.get(pre)?.highlight !== false}>
        {renderHast(d.tree, { components: { ...SHARED_COMPONENTS, a: DocLink } })}
      </PreHighlightContext>,
    );
    expect(keywordsPerBlock(container)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(container.querySelectorAll('pre > code')[8]?.textContent).toBe(body(BLOCK).slice(0, -1));
  });

  it('with no provider (chat) all nine are highlighted: the block rule alone decides', () => {
    const d = detachUrls(page(Array.from({ length: 9 }, () => BLOCK)));
    const { container } = render(renderHast(d.tree, { components: SHARED_COMPONENTS }));
    expect(keywordsPerBlock(container)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1]);
  });

  it('pre passes the decision the node it renders: the provider is asked about that element and no other', () => {
    const d = detachUrls(page([13, 13, 13]));
    const second = pres(d.tree)[1];
    const asked: HastElement[] = [];
    const { container } = render(
      <PreHighlightContext value={(pre) => { asked.push(pre); return pre !== second; }}>
        {renderHast(d.tree, { components: SHARED_COMPONENTS })}
      </PreHighlightContext>,
    );
    expect(keywordsPerBlock(container)).toEqual([1, 0, 1]);
    expect(new Set(asked)).toEqual(new Set(pres(d.tree)));
  });
});
