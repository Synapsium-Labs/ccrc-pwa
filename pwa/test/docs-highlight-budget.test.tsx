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

/** A fenced `python` block as the parse emits it: `pre > code.language-python`, holding `text` (python, not `ts`: a
 *  `ts` block also draws on the scan budget of D-4928, which the cases below measure on their own). */
const fence = (text: string): HastElement => ({
  type: 'element', tagName: 'pre', properties: {},
  children: [{ type: 'element', tagName: 'code', properties: { className: ['language-python'] }, children: [{ type: 'text', value: text }] }],
});

/** `chars` characters of Python holding exactly one keyword, then `x` and a space in turn, broken into lines under
 *  100 characters (a line over `MD_HIGHLIGHT_MAX_LINE_CHARS` is never highlighted, and a long run of blank units over
 *  `MD_HIGHLIGHT_MAX_BLANK_CHARS` neither), then the newline the parse keeps: cheap for highlight.js, so the case
 *  measures the decision, not the grammar. */
const body = (chars: number): string =>
  'import a = 1' + Array.from({ length: chars - 13 }, (_, i) => ((i + 1) % 100 === 0 ? '\n' : i % 2 === 0 ? 'x' : ' ')).join('') + '\n';

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

  it('nine 60 000-character python blocks: the first eight are highlighted and the ninth is not', () => {
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

describe('D-4928: the scan budget, a page\'s code of typescript, javascript and rust together (393 216 characters)', () => {
  // Literal sizes, never the imported constant, so a mutated constant reds a behaviour case.
  const lang = (name: string, text: string): HastElement => ({
    type: 'element', tagName: 'pre', properties: {},
    children: [{ type: 'element', tagName: 'code', properties: { className: [`language-${name}`] }, children: [{ type: 'text', value: text }] }],
  });
  const filler = (n: number): string => 'x'.repeat(n);
  const decisions = (blocks: readonly HastElement[]): (boolean | null | undefined)[] => {
    const d = detachUrls({ type: 'root', children: [...blocks] });
    return pres(d.tree).map((p) => d.urls.get(p)?.highlight);
  };

  it('(a) 49 ts blocks of 8 192 characters: the first 48 (exactly 393 216) are highlighted, the 49th is not', () => {
    const got = decisions(Array.from({ length: 49 }, () => lang('ts', filler(8192))));
    expect(got.slice(0, 48)).toEqual(Array.from({ length: 48 }, () => true));
    expect(got[48]).toBe(false);
  });

  it('(b) a json block after them is still highlighted: another grammar is never refused by the scan budget', () => {
    const got = decisions([...Array.from({ length: 49 }, () => lang('ts', filler(8192))), lang('json', filler(100))]);
    expect(got[48]).toBe(false);
    expect(got[49]).toBe(true);
  });

  it('(c) rust and javascript blocks count in the same sum, aliases included', () => {
    const got = decisions([
      lang('rust', filler(131072)), lang('jsx', filler(131072)), lang('rs', filler(131072)), lang('tsx', filler(1)),
    ]);
    expect(got).toEqual([true, true, true, false]);
  });

  it('(d) code of other grammars does not use the scan budget: 400 KiB of json leaves a later small ts block highlighted', () => {
    const got = decisions([lang('json', filler(409600)), lang('ts', filler(100))]);
    expect(got).toEqual([true, true]);
  });

  it('the page budget still refuses a ts block past it, and the scan budget refuses only the three grammars', () => {
    const got = decisions([lang('python', filler(524288)), lang('ts', filler(100)), lang('json', filler(1))]);
    expect(got).toEqual([true, false, false]);
  });

  it('(e) xml and markdown reach no bounded grammar, so they do not count in the scan sum: an xml block after the ts budget is spent is still highlighted', () => {
    const got = decisions([...Array.from({ length: 48 }, () => lang('ts', filler(8192))), lang('xml', filler(8192)), lang('ts', filler(1))]);
    expect(got.slice(0, 48)).toEqual(Array.from({ length: 48 }, () => true));
    expect(got[48]).toBe(true);
    expect(got[49]).toBe(false);
    expect(decisions([lang('svg', filler(393216)), lang('md', filler(1)), lang('ts', filler(1))])).toEqual([true, true, true]);
  });

  it('a block with no language is counted by the page budget only', () => {
    const bare: HastElement = { type: 'element', tagName: 'pre', properties: {},
      children: [{ type: 'element', tagName: 'code', properties: {}, children: [{ type: 'text', value: filler(400000) }] }] };
    expect(decisions([bare, lang('ts', filler(100))])).toEqual([true, true]);
  });
});
