// Docs W5 part 1, Task 6: the page highlight budget (spec 2026-10-01 4.10 "Highlighting"; M4.H2; refinement (h)).
// `detachUrls` sums `pre > code` text in document order and records `highlight: false` for every block from the one
// that takes the sum past `DOCS_HIGHLIGHT_PAGE_MAX_CHARS`; `SHARED_COMPONENTS.pre` reads `PreHighlightContext` with
// the `node` it is given, so a Docs page that provides the decision gives `CodeBlock` `highlight={false}` for those
// blocks, and chat, which provides nothing, is decided by the block rule alone, as before. The trees are built by
// hand, exactly as the parse emits a fenced block, so no case parses half a megabyte.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import hljs from 'highlight.js/lib/core';
import { PreHighlightContext, SHARED_COMPONENTS } from '../src/lib/markdown';
import {
  DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS, DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS,
  MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS,
} from '../src/lib/markdownLimits';
import { renderHast } from '../src/lib/renderHast';
import { DocLink } from '../src/docs/DocLink';
import { detachUrls } from '../src/docs/docsLinks';

afterEach(cleanup);

/** A fenced `python` block as the parse emits it: `pre > code.language-python`, holding `text` (python, not `ts`: a
 *  `ts` block also draws on the scan budget of review 450 F1, which the cases below measure on their own). */
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

describe('review 450 F1: the scan budget, a page\'s code of typescript, javascript and rust together (393 216 characters)', () => {
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

describe('review 450 F1: the markdown budget, a page\'s markdown code (131 072 characters), outside the scan set', () => {
  // Literal sizes, never the imported constants, so a mutated constant reds a behaviour case.
  const lang = (name: string, text: string): HastElement => ({
    type: 'element', tagName: 'pre', properties: {},
    children: [{ type: 'element', tagName: 'code', properties: { className: [`language-${name}`] }, children: [{ type: 'text', value: text }] }],
  });
  const filler = (n: number): string => 'x'.repeat(n);
  /** `n` characters of the measured worst shape for markdown (its tags go to xml): `</a>` repeated, in lines of 1 797
   *  characters (under the line bound). */
  const worst = (n: number): string => ('</a>'.repeat(449) + '\n').repeat(Math.ceil(n / 1797)).slice(0, n);
  const decisions = (blocks: readonly HastElement[]): (boolean | null | undefined)[] => {
    const d = detachUrls({ type: 'root', children: [...blocks] });
    return pres(d.tree).map((p) => d.urls.get(p)?.highlight);
  };

  it('(a) three markdown blocks of 65 536 characters: the first two (exactly 131 072) are highlighted, the third is not', () => {
    expect(decisions([lang('markdown', worst(65536)), lang('markdown', worst(65536)), lang('markdown', worst(65536))]))
      .toEqual([true, true, false]);
  });

  it('(a2) at the budget: markdown blocks summing to exactly 131 072 all highlight, one more character in a following markdown block does not', () => {
    expect(decisions([
      lang('markdown', worst(32768)), lang('md', worst(32768)), lang('markdown', worst(32768)), lang('markdown', worst(32768)),
      lang('markdown', worst(1)),
    ])).toEqual([true, true, true, true, false]);
  });

  it('(b) an md block counts in the same sum, every alias highlight.js resolves to markdown included', () => {
    expect(decisions([lang('md', filler(65536)), lang('markdown', filler(65535)), lang('mkdown', filler(2))])).toEqual([true, true, false]);
    expect(decisions([lang('markdown', filler(65536)), lang('md', filler(65537))])).toEqual([true, false]);
  });

  it('(c) a yaml block and a ts block after them are still highlighted: another grammar is never refused by it', () => {
    expect(decisions([
      lang('markdown', filler(65536)), lang('markdown', filler(65536)), lang('markdown', filler(1)),
      lang('yaml', filler(100)), lang('ts', filler(100)),
    ])).toEqual([true, true, false, true, true]);
  });

  it('(d) markdown does not count in the scan sum: a ts block after 64 KiB of markdown is highlighted, and only its own sum refuses the next', () => {
    // 65 536 + 393 216 + 1 = 458 753, under the page budget (524 288): the last block is refused by the scan sum alone.
    expect(decisions([lang('md', filler(65536)), lang('ts', filler(393216)), lang('ts', filler(1))]))
      .toEqual([true, true, false]);
  });

  it('(d2) code of other grammars does not use the markdown budget: 131 072 characters of yaml and of json leave two markdown blocks of 65 536 highlighted', () => {
    expect(decisions([lang('yaml', filler(131072)), lang('json', filler(65536)), lang('markdown', worst(65536)), lang('md', worst(65536))]))
      .toEqual([true, true, true, true]);
  });

  it('(e) the page budget still refuses a markdown block past it', () => {
    expect(decisions([lang('python', filler(524288)), lang('markdown', filler(1))])).toEqual([true, false]);
  });

  it('(f) rendered: a third 64 KiB markdown block renders unhighlighted through PreHighlightContext, the first two highlighted', () => {
    const md = (): HastElement => lang('markdown', worst(65536));
    const d = detachUrls({ type: 'root', children: [md(), md(), md()] });
    expect(pres(d.tree).map((p) => d.urls.get(p)?.highlight)).toEqual([true, true, false]);
    const { container } = render(
      <PreHighlightContext value={(pre) => d.urls.get(pre)?.highlight !== false}>
        {renderHast(d.tree, { components: SHARED_COMPONENTS })}
      </PreHighlightContext>,
    );
    const marks = [...container.querySelectorAll('.code-block')].map((b) => b.querySelectorAll('.hljs-tag').length);
    expect(marks.slice(0, 2).every((n) => n > 0)).toBe(true);
    expect(marks[2]).toBe(0);
  }, 60000);
});

// Review 460 F10 asked for the end-to-end page "under the target" as a timed reading; a wall-clock assertion is
// load-sensitive on a shared box, so this case replaces it with the decision itself: which blocks of a mixed crafted
// page `detachUrls` and `CodeBlock` highlight and which they refuse, under each budget, read from what highlight.js was
// asked to highlight. The timings of the same pages are recorded in the plan's results (review 460 F10).
describe('review 460 F10: which blocks of a mixed crafted page are highlighted, end to end', () => {
  const lang = (name: string, text: string): HastElement => ({
    type: 'element', tagName: 'pre', properties: {},
    children: [{ type: 'element', tagName: 'code', properties: { className: [`language-${name}`] }, children: [{ type: 'text', value: text }] }],
  });
  /** One block's text as the parse leaves it: `chars` characters (a first line naming `tag` so every block is unique, then
   *  `unit` lines, cheap for highlight.js and well inside the word, line and blank bounds), then the newline it keeps. */
  const text = (tag: string, comment: string, unit: string, chars: number): string =>
    (`${comment} ${tag}\n` + unit.repeat(Math.ceil(chars / unit.length))).slice(0, chars) + '\n';
  // One comment, key or heading per 92-character line: highlightable, few elements per block (the case holds about a
  // megabyte of code, rendered), and each line far under the word, line and blank bounds.
  const TS = `// ${'c'.repeat(88)}\n`;
  const YAML = `# ${'c'.repeat(88)}\n`;
  const MD = `# ${'h'.repeat(88)}\n`;
  /** A block of `lang` name holding `chars` characters (the newline not counted), numbered `tag`. */
  const block = (name: string, tag: string, chars: number): { name: string; text: string } => {
    const kind = name === 'yaml' ? ['#', YAML] : name === 'markdown' || name === 'md' ? ['#', MD] : ['//', TS];
    return { name, text: text(tag, kind[0]!, kind[1]!, chars) };
  };
  /** Render a page through `detachUrls`, PreHighlightContext and SHARED_COMPONENTS, as the Docs page does; return, in block
   *  order, whether highlight.js was asked to highlight each block's text, and each block's label. */
  const run = (blocks: readonly { name: string; text: string }[]): { highlighted: boolean[]; labels: string[] } => {
    // Calls through, so the page is really highlighted; only the text asked is kept (a spy would keep every result too).
    const asked = new Set<string>();
    const real = hljs.highlight;
    hljs.highlight = ((code: string, ...rest: unknown[]) => {
      asked.add(code);
      return (real as (...a: unknown[]) => unknown)(code, ...rest);
    }) as typeof hljs.highlight;
    try {
      const d = detachUrls({ type: 'root', children: blocks.map((b) => lang(b.name, b.text)) });
      const { container } = render(
        <PreHighlightContext value={(pre) => d.urls.get(pre)?.highlight !== false}>
          {renderHast(d.tree, { components: { ...SHARED_COMPONENTS, a: DocLink } })}
        </PreHighlightContext>,
      );
      expect(container.querySelectorAll('.code-block')).toHaveLength(blocks.length);
      expect(new Set(blocks.map((b) => b.text)).size).toBe(blocks.length);
      return {
        highlighted: blocks.map((b) => asked.has(b.text.slice(0, -1))),
        labels: [...container.querySelectorAll('.code-block-lang')].map((l) => l.textContent ?? ''),
      };
    } finally {
      hljs.highlight = real;
      cleanup();
    }
  };

  it('end to end through detachUrls and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits', () => {
    const tsChars = MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS - 1; // the newline the parse keeps brings it to the cap
    const mdChars = MD_HIGHLIGHT_BLOCK_MAX_CHARS - 1;
    const tsCount = DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS / MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS;
    const mdCount = DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS / MD_HIGHLIGHT_BLOCK_MAX_CHARS;
    expect(Number.isInteger(tsCount) && Number.isInteger(mdCount)).toBe(true);
    expect(tsCount * MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS + mdCount * MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    const tsFill = (): { name: string; text: string }[] => Array.from({ length: tsCount }, (_, i) => block('ts', `fill ${i}`, tsChars));

    // Page S, the scan budget: 48 ts blocks fill it exactly; then tsx (a ts alias), javascript and rust are refused, yaml is not.
    const s = run([
      ...tsFill(),
      block('tsx', 's-tsx', 100), block('yaml', 's-yaml', 100), block('javascript', 's-js', 100), block('rust', 's-rust', 100),
      block('ts', 's-over', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS + 1),
    ]);
    expect(s.highlighted).toEqual([...Array.from({ length: tsCount }, () => true), false, true, false, false, false]);
    expect(s.labels[s.labels.length - 1]).toMatch(/ · not highlighted \(9 KiB\)$/);

    // Page M, the markdown budget: a markdown and an md block fill it exactly; then a small markdown block is refused, yaml is not.
    const m = run([
      block('markdown', 'm-1', mdChars), block('md', 'm-2', mdChars), block('markdown', 'm-3', 100), block('yaml', 'm-yaml', 100),
    ]);
    expect(m.highlighted).toEqual([true, true, false, true]);

    // Page G, the general budget (the accepted residue's page): 48 ts blocks and two markdown blocks fill it exactly,
    // all 50 highlighted; yaml is in neither sub-budget and is refused by the general one.
    const g = run([
      ...tsFill(), block('markdown', 'g-1', mdChars), block('markdown', 'g-2', mdChars), block('yaml', 'g-yaml', 100),
    ]);
    expect(g.highlighted).toEqual([...Array.from({ length: tsCount + mdCount }, () => true), false]);
  }, 60000);
});
