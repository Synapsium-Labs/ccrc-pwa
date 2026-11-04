// Docs W5 part 1, Task 6: the page highlight budget (spec 2026-10-01 4.10 "Highlighting"; M4.H2; refinement (h)),
// rewritten by W5h-a Task 6 (refinement (j)): the decisions moved from `detachUrls` into the page store's seed
// (`highlightStore.ts`). The store sums each requestable block, repeats included (D-7762), in document order, over
// its raw text (one trailing newline stripped, as `CodeBlock` strips it), and a key past a budget is `skipped` from
// the first commit:
// `skipped:page-input` for the general budget, `skipped:part1-scan` and `skipped:part1-markdown` for part 1's two
// sub-budgets (until W5h-b). A block over its own cap, or in no registered grammar, is no requestable block and
// counts nothing. The trees are built by hand, exactly as the parse emits a fenced block, so no case parses half a
// megabyte; every block of a boundary case is distinct (the repeated-copy cases below say so) and bounds-clean (no
// word, line or blank run over part 1's bounds). The rendered cases draw `DocMarkdown` under a production store over an
// in-thread highlighter, so the page's seed, requests and check are the shipped ones.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import { HLJS } from '../src/lib/highlightGrammars';
import { HighlighterContext, createProductionStore } from '../src/lib/highlighterContext';
import { codeBlocksOf, type HighlightStore } from '../src/lib/highlightStore';
import { PreHighlightContext, SHARED_COMPONENTS } from '../src/lib/markdown';
import {
  DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS,
  DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS,
  MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS,
} from '../src/lib/markdownLimits';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { renderHast } from '../src/lib/renderHast';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import { DocMarkdown } from '../src/docs/DocMarkdown';
import { treeOk } from './docsFixtures';
import type { HighlightOutcome } from '../src/lib/highlightProtocol';
import { inThreadContext, inThreadHighlighter, type InThreadHighlighter } from './highlightTestStore';

afterEach(cleanup);

/** Each fixture block gets its own serial, so no two blocks of one case share a key. */
let serial = 0;
beforeEach(() => { serial = 0; });

/** `text` with its first characters replaced by `i` in base 36, its length unchanged. */
const distinct = (text: string, i: number): string => (i.toString(36) + text.slice(i.toString(36).length)).slice(0, text.length);

/** `n` characters of bounds-clean, distinct text: lines of 99 `x` and a newline, the last character never a newline. */
const filler = (n: number): string =>
  distinct(('x'.repeat(99) + '\n').repeat(Math.ceil(n / 100)).slice(0, n).replace(/\n$/, 'x'), serial++);

/** A `pre > code` as the parse emits it, whose class is `className` (an array, a string or none), holding `text`. */
const block = (className: readonly string[] | string | undefined, text: string): HastElement => {
  const properties = (className === undefined ? {}
    : { className: typeof className === 'string' ? className : [...className] }) as HastElement['properties'];
  return {
    type: 'element', tagName: 'pre', properties: {},
    children: [{ type: 'element', tagName: 'code', properties, children: [{ type: 'text', value: text }] }],
  };
};
/** One block of `n` raw characters in `name`. */
const lang = (name: string, n: number): HastElement => block([`language-${name}`], filler(n));
/** Blocks of class `className` of at most `cap` raw characters each, summing to `total` (the grammar's own cap, literal). */
const spread = (className: readonly string[] | string, total: number, cap: number): HastElement[] =>
  Array.from({ length: Math.ceil(total / cap) }, (_, i) => block(className, filler(Math.min(cap, total - i * cap))));
const spreadLang = (name: string, total: number, cap: number): HastElement[] => spread([`language-${name}`], total, cap);
const rep = <T,>(x: T, n: number): T[] => Array.from({ length: n }, () => x);
const root = (blocks: readonly HastElement[]): HastRoot => ({ type: 'root', children: [...blocks] });

/** Each block's admission as the page's store decides it at seed, in document order: `admitted`, `skipped` (by
 *  which ceiling) or why it can never be requested. */
function decisions(r: HastRoot): string[] {
  const store = createProductionStore(inThreadHighlighter({ hold: true }), 'docs');
  const blocks = codeBlocksOf(r);
  store.seed(blocks);
  return blocks.map((b) => {
    const k = store.keyOf(b.lang, b.raw);
    if (k.kind !== 'key') return k.kind;
    const e = store.peek(k.key);
    return e.kind === 'skipped' ? `skipped:${e.ceiling}` : 'admitted';
  });
}
const A = 'admitted';
const INPUT = 'skipped:page-input';
const SCAN = 'skipped:part1-scan';
const MARKDOWN = 'skipped:part1-markdown';

/** A fenced `python` block as the parse emits it: `pre > code.language-python`, holding `text` (python, not `ts`: a
 *  `ts` block also draws on the scan budget of review 450 F1, which the cases below measure on their own). */
const fence = (text: string): HastElement => block(['language-python'], text);

/** `chars` characters of Python holding exactly one keyword, then `x` and a space in turn, broken into lines under
 *  100 characters (a line over `MD_HIGHLIGHT_MAX_LINE_CHARS` is never highlighted, and a long run of blank units over
 *  `MD_HIGHLIGHT_MAX_BLANK_CHARS` neither), then the newline the parse keeps: cheap for highlight.js, so the case
 *  measures the decision, not the grammar. `i` makes it distinct (`import a<i> = 1`), its length unchanged. */
const body = (chars: number, i: number): string => {
  const head = `import a${i.toString(36)} = 1`;
  return head + Array.from({ length: chars - 1 - head.length }, (_, k) => ((k + 1) % 100 === 0 ? '\n' : k % 2 === 0 ? 'x' : ' ')).join('') + '\n';
};

/** A page of python blocks of `sizes` RAW characters each (the parse's newline comes on top). */
const page = (sizes: readonly number[]): HastRoot => root(sizes.map((n, i) => fence(body(n + 1, i))));

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'project-a', pageRef: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => {},
};

/** `tree` as one Docs page through `DocMarkdown`, under production stores over `docs` (in-thread, answering at once),
 *  waited until the page's store (published through the context's slot) has settled and React has drawn it. */
async function drawn(tree: HastRoot, docs: InThreadHighlighter = inThreadHighlighter()) {
  let published: HighlightStore | null = null;
  const ctx = inThreadContext(docs, inThreadHighlighter(), (s) => { published = s; });
  const parser = vi.fn<MarkdownParser>(async () => ({ kind: 'tree', tree, depth: 3 }));
  const wanted = tree.children.filter((c) => c.type === 'element' && c.tagName === 'pre').length;
  const r = render(
    <HighlighterContext value={ctx}>
      <DocMarkdown text="budget page" pinKey="p" parser={parser} link={LINK} />
    </HighlighterContext>,
  );
  await waitFor(() => expect(r.container.querySelectorAll('.code-block')).toHaveLength(wanted));
  await waitFor(() => expect((published as HighlightStore | null)?.settled()).toBe(true), { timeout: 30000 });
  await act(async () => { await new Promise((done) => setTimeout(done, 0)); });
  return { ...r, docs, store: published as unknown as HighlightStore };
}

const BLOCK = 60000;

describe('the page store records each pre\'s decision in document order at seed (W5h-a; was detachUrls, spec 4.10; refinement (n))', () => {
  it('admitted while the running sum is within the budget, skipped from the block that passes it, for every later block', () => {
    // Blocks at the 65 536-character cap: seven, then 65 516 + 20 (exactly the 524 288 budget), then 13 and 13 past it.
    const got = decisions(page([...rep(MD_HIGHLIGHT_BLOCK_MAX_CHARS, 7), MD_HIGHLIGHT_BLOCK_MAX_CHARS - 20, 20, 13, 13]));
    expect(got).toEqual([...rep(A, 9), INPUT, INPUT]);
    expect(7 * MD_HIGHLIGHT_BLOCK_MAX_CHARS + MD_HIGHLIGHT_BLOCK_MAX_CHARS - 20 + 20).toBe(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
  });

  it('a pre with no code child is no requestable block and counts nothing', () => {
    const lead: HastElement = { type: 'element', tagName: 'pre', properties: {},
      children: [{ type: 'text', value: 'x'.repeat(DOCS_HIGHLIGHT_PAGE_MAX_CHARS + 1) }] };
    expect(decisions(root([lead, fence(body(14, 0))]))).toEqual(['unregistered', A]);
  });
});

describe('M4.H2: the page budget reaches CodeBlock through the page store (refinement (h))', () => {
  it('the fixture: eight 60 000-character blocks fit the page budget, nine do not, and each is within the block cap', () => {
    expect(body(BLOCK + 1, 0)).toHaveLength(BLOCK + 1);
    expect(8 * BLOCK).toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    expect(9 * BLOCK).toBeGreaterThan(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    expect(BLOCK).toBeLessThanOrEqual(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
  });

  const keywordsPerBlock = (c: HTMLElement): number[] =>
    [...c.querySelectorAll('.code-block')].map((b) => b.querySelectorAll('.hljs-keyword').length);

  it('nine 60 000-character python blocks: the first eight are highlighted and the ninth is not', async () => {
    const tree = page(rep(BLOCK, 9));
    expect(decisions(tree)).toEqual([...rep(A, 8), INPUT]);
    const { container, docs } = await drawn(tree);
    expect(keywordsPerBlock(container)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 0]);
    expect(container.querySelectorAll('.code-block-lang')[8]?.textContent).toBe('Python · not highlighted (page highlighting limit)');
    expect(container.querySelectorAll('pre > code')[8]?.textContent).toBe(body(BLOCK + 1, 8).slice(0, -1));
    expect(docs.calls).toHaveLength(8);
  }, 60000);

  it('on a chat store (no page ceiling on input) all nine are highlighted: the block rule alone decides', async () => {
    const tree = page(rep(BLOCK, 9));
    const h = inThreadHighlighter();
    const store = createProductionStore(h, 'chat');
    const { container } = render(
      <PreHighlightContext value={store}>{renderHast(tree, { components: SHARED_COMPONENTS })}</PreHighlightContext>,
    );
    await waitFor(() => expect(keywordsPerBlock(container)).toEqual(rep(1, 9)), { timeout: 30000 });
    expect(h.calls).toHaveLength(9);
  }, 60000);

  it('each pre asks the store about its own text: the second block, over the block cap, is never requested; the first and third are', async () => {
    const tree = page([13, MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1, 13]);
    const h = inThreadHighlighter();
    const store = createProductionStore(h, 'docs');
    store.seed(codeBlocksOf(tree));
    const { container } = render(
      <PreHighlightContext value={store}>{renderHast(tree, { components: SHARED_COMPONENTS })}</PreHighlightContext>,
    );
    await waitFor(() => expect(keywordsPerBlock(container)).toEqual([1, 0, 1]));
    expect(h.calls.map((c) => c.code)).toEqual([body(14, 0).slice(0, -1), body(14, 2).slice(0, -1)]);
    expect(container.querySelectorAll('.code-block-lang')[1]?.textContent).toBe('Python · not highlighted (65 KiB)');
  });
});

describe('review 450 F1: the scan budget, a page\'s code of typescript, javascript and rust together (393 216 characters)', () => {
  // Literal sizes, never the imported constant, so a mutated constant reds a behaviour case. Each block is at most its
  // grammar's own cap: typescript and javascript 8 192, rust 4 096, every other grammar 65 536.
  it('(a) 49 ts blocks of 8 192 characters: the first 48 (exactly 393 216) are admitted, the 49th is skipped by the scan budget', () => {
    expect(decisions(root(spreadLang('ts', 49 * 8192, 8192)))).toEqual([...rep(A, 48), SCAN]);
  });

  it('(b) a json block after them is still admitted: another grammar is never refused by the scan budget', () => {
    expect(decisions(root([...spreadLang('ts', 49 * 8192, 8192), lang('json', 100)]))).toEqual([...rep(A, 48), SCAN, A]);
  });

  it('(c) rust and javascript blocks count in the same sum, aliases included', () => {
    expect(decisions(root([
      ...spreadLang('rust', 131072, 4096), ...spreadLang('jsx', 131072, 8192), ...spreadLang('rs', 131072, 4096), lang('tsx', 1),
    ]))).toEqual([...rep(A, 32 + 16 + 32), SCAN]);
  });

  it('(d) code of other grammars does not use the scan budget: 400 KiB of json leaves a later small ts block admitted', () => {
    expect(decisions(root([...spreadLang('json', 409600, 65536), lang('ts', 100)]))).toEqual(rep(A, 7 + 1));
  });

  it('the page budget still refuses a ts block past it, and the scan budget refuses only the three grammars', () => {
    expect(decisions(root([...spreadLang('python', 524288, 65536), lang('ts', 100), lang('json', 1)])))
      .toEqual([...rep(A, 8), INPUT, INPUT]);
  });

  it('(e) xml and markdown reach no bounded grammar, so they do not count in the scan sum: an xml block after the ts budget is spent is still admitted', () => {
    expect(decisions(root([...spreadLang('ts', 48 * 8192, 8192), lang('xml', 8192), lang('ts', 1)])))
      .toEqual([...rep(A, 48), A, SCAN]);
    expect(decisions(root([...spreadLang('svg', 393216, 65536), lang('md', 1), lang('ts', 1)]))).toEqual(rep(A, 6 + 2));
  });

  it('a block with no language is no requestable block and counts against no budget', () => {
    const bare: HastElement = block(undefined, 'x'.repeat(400000));
    expect(decisions(root([bare, lang('ts', 100)]))).toEqual(['unregistered', A]);
  });
});

describe('review 450 F1: the markdown budget, a page\'s markdown code (131 072 characters), outside the scan set', () => {
  // Literal sizes, never the imported constants, so a mutated constant reds a behaviour case.
  /** `n` characters of the measured worst shape for markdown (its tags go to xml): `</a>` repeated, in lines of 1 797
   *  characters (under the line bound), distinct by a leading serial, the last character never a newline. */
  const worst = (n: number): string =>
    distinct(('</a>'.repeat(449) + '\n').repeat(Math.ceil(n / 1797)).slice(0, n).replace(/\n$/, '>'), serial++);
  const md = (name: string, n: number): HastElement => block([`language-${name}`], worst(n));

  it('(a) three markdown blocks of 65 536 characters: the first two (exactly 131 072) are admitted, the third is skipped', () => {
    expect(decisions(root([md('markdown', 65536), md('markdown', 65536), md('markdown', 65536)]))).toEqual([A, A, MARKDOWN]);
  });

  it('(a2) at the budget: markdown blocks summing to exactly 131 072 are all admitted, one more character in a following markdown block is skipped', () => {
    expect(decisions(root([
      md('markdown', 32768), md('md', 32768), md('markdown', 32768), md('markdown', 32768), md('markdown', 1),
    ]))).toEqual([A, A, A, A, MARKDOWN]);
  });

  it('(b) an md block counts in the same sum, every alias highlight.js resolves to markdown included', () => {
    expect(decisions(root([lang('md', 65536), lang('markdown', 65535), lang('mkdown', 2)]))).toEqual([A, A, MARKDOWN]);
    expect(decisions(root([lang('markdown', 65536), lang('md', 65535), lang('md', 1), lang('md', 1)]))).toEqual([A, A, A, MARKDOWN]);
  });

  it('(c) a yaml block and a ts block after them are still admitted: another grammar is never refused by it', () => {
    expect(decisions(root([
      lang('markdown', 65536), lang('markdown', 65536), lang('markdown', 1), lang('yaml', 100), lang('ts', 100),
    ]))).toEqual([A, A, MARKDOWN, A, A]);
  });

  it('(d) markdown does not count in the scan sum: a ts block after 64 KiB of markdown is admitted, and only its own sum refuses the next', () => {
    // 65 536 + 393 216 + 1 = 458 753, under the page budget (524 288): the last block is refused by the scan sum alone.
    expect(decisions(root([lang('md', 65536), ...spreadLang('ts', 393216, 8192), lang('ts', 1)])))
      .toEqual([A, ...rep(A, 48), SCAN]);
  });

  it('(d2) code of other grammars does not use the markdown budget: 131 072 characters of yaml and of json leave two markdown blocks of 65 536 admitted', () => {
    expect(decisions(root([
      ...spreadLang('yaml', 131072, 65536), lang('json', 65536), md('markdown', 65536), md('md', 65536),
    ]))).toEqual(rep(A, 5));
  });

  it('(e) the page budget still refuses a markdown block past it', () => {
    expect(decisions(root([...spreadLang('python', 524288, 65536), lang('markdown', 1)]))).toEqual([...rep(A, 8), INPUT]);
  });

  // R-P1 (W5h-a): the shipped per-block HTML cap (MD_HIGHLIGHT_MAX_HTML_CHARS) keeps a 64 KiB block of the worst shape
  // plain, as the markup of `</a>` is far over it. Part 1's decision is what this case keeps red-able: the first two
  // blocks are admitted and requested, the third is skipped by the markdown budget and never requested; then the shipped
  // outcome (plain, "output too large", the line retry refused) over the measured HTML cap.
  it('(f) rendered: a third 64 KiB markdown block is skipped (bare label, never requested), the first two are admitted and requested and stay plain over the measured HTML cap', async () => {
    const tree = root([md('markdown', 65536), md('markdown', 65536), md('markdown', 65536)]);
    expect(decisions(tree)).toEqual([A, A, MARKDOWN]);
    const { container, docs, store } = await drawn(tree);
    const blocks = codeBlocksOf(tree);
    // The block-mode requests are the first two blocks' texts, in order; the third is never requested.
    expect(docs.calls.filter((c) => c.mode === undefined).map((c) => c.code)).toEqual([blocks[0]!.raw, blocks[1]!.raw]);
    expect(docs.calls.some((c) => c.code === blocks[2]!.raw)).toBe(false);
    const labels = [...container.querySelectorAll('.code-block-lang')].map((l) => l.textContent);
    expect(labels).toEqual(['Markdown · not highlighted (output too large)', 'Markdown · not highlighted (output too large)', 'Markdown']);
    for (const b of container.querySelectorAll('.code-block')) expect(b.querySelectorAll('.hljs-tag')).toHaveLength(0);
    for (const b of blocks.slice(0, 2)) {
      const k = store.keyOf(b.lang, b.raw);
      expect(k.kind).toBe('key');
      const e = store.peek(k.kind === 'key' ? k.key : '');
      // First answer too large; the line retry (lines of 1 797 characters) is refused by the worker as a line too long.
      expect(e).toMatchObject({ kind: 'plain', first: { kind: 'too-large' }, retry: { kind: 'line-too-long' } });
    }
    // Measured outside the store, the first block's markup is over the cap (never an exact length).
    expect(HLJS.highlight(blocks[0]!.raw, { language: 'markdown', ignoreIllegals: true }).value.length).toBeGreaterThan(MD_HIGHLIGHT_MAX_HTML_CHARS);
  }, 60000);
});

// Review 460 F10 asked for the end-to-end page "under the target" as a timed reading; a wall-clock assertion is
// load-sensitive on a shared box, so this case replaces it with the decision itself: which blocks of a mixed crafted
// page the page store admits and colours, and which it refuses, under each budget, read from the rendered page (the
// page is drawn through `DocMarkdown` over an in-thread highlighter). The timings of the same pages are recorded in the
// plan's results (review 460 F10).
describe('review 460 F10: which blocks of a mixed crafted page are highlighted, end to end', () => {
  /** One block's text as the parse leaves it: `chars` raw characters (a first line naming `tag` so every block is unique,
   *  then `unit` lines, cheap for highlight.js and well inside the word, line and blank bounds), then the newline it keeps. */
  const text = (tag: string, comment: string, unit: string, chars: number): string =>
    (`${comment} ${tag}\n` + unit.repeat(Math.ceil(chars / unit.length))).slice(0, chars) + '\n';
  // One comment, key or heading per 92-character line: highlightable, few elements per block (the case holds about a
  // megabyte of code, rendered), and each line far under the word, line and blank bounds.
  const TS = `// ${'c'.repeat(88)}\n`;
  const YAML = `# ${'c'.repeat(88)}\n`;
  const MD = `# ${'h'.repeat(88)}\n`;
  /** A block of `lang` name holding `chars` raw characters, numbered `tag`. */
  const mixed = (name: string, tag: string, chars: number): { name: string; text: string } => {
    const kind = name === 'yaml' ? ['#', YAML] : name === 'markdown' || name === 'md' ? ['#', MD] : ['//', TS];
    return { name, text: text(tag, kind[0]!, kind[1]!, chars) };
  };
  /** Render a page through the page store, as the Docs page does; return, in block order, whether each block is
   *  coloured (any span in its code) and each block's label. */
  const run = async (blocks: readonly { name: string; text: string }[]): Promise<{ highlighted: boolean[]; labels: string[] }> => {
    expect(new Set(blocks.map((b) => b.text)).size).toBe(blocks.length);
    const { container } = await drawn(root(blocks.map((b) => block([`language-${b.name}`], b.text))));
    expect(container.querySelectorAll('.code-block')).toHaveLength(blocks.length);
    return {
      highlighted: [...container.querySelectorAll('.code-block')].map((b) => b.querySelector('code.hljs span') !== null),
      labels: [...container.querySelectorAll('.code-block-lang')].map((l) => l.textContent ?? ''),
    };
  };

  it('end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks each budget admits', async () => {
    const tsChars = MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS; // raw characters: the cap is inclusive
    const mdChars = MD_HIGHLIGHT_BLOCK_MAX_CHARS;
    const tsCount = DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS / MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS;
    const mdCount = DOCS_HIGHLIGHT_MARKDOWN_PAGE_MAX_CHARS / MD_HIGHLIGHT_BLOCK_MAX_CHARS;
    expect(Number.isInteger(tsCount) && Number.isInteger(mdCount)).toBe(true);
    expect(tsCount * MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS + mdCount * MD_HIGHLIGHT_BLOCK_MAX_CHARS).toBe(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    const tsFill = (): { name: string; text: string }[] => Array.from({ length: tsCount }, (_, i) => mixed('ts', `fill ${i}`, tsChars));

    // Page S, the scan budget: 48 ts blocks fill it exactly; then tsx (a ts alias), javascript and rust are refused, yaml is not.
    const s = await run([
      ...tsFill(),
      mixed('tsx', 's-tsx', 100), mixed('yaml', 's-yaml', 100), mixed('javascript', 's-js', 100), mixed('rust', 's-rust', 100),
      mixed('ts', 's-over', MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS + 1),
    ]);
    expect(s.highlighted).toEqual([...rep(true, tsCount), false, true, false, false, false]);
    expect(s.labels[s.labels.length - 1]).toMatch(/ · not highlighted \(9 KiB\)$/);

    // Page M, the markdown budget: a markdown and an md block fill it exactly; then a small markdown block is refused, yaml is not.
    const m = await run([
      mixed('markdown', 'm-1', mdChars), mixed('md', 'm-2', mdChars), mixed('markdown', 'm-3', 100), mixed('yaml', 'm-yaml', 100),
    ]);
    expect(m.highlighted).toEqual([true, true, false, true]);

    // Page G, the general budget (the accepted residue's page): 48 ts blocks and two markdown blocks fill it exactly,
    // all 50 highlighted; yaml is in neither sub-budget and is refused by the general one.
    const g = await run([
      ...tsFill(), mixed('markdown', 'g-1', mdChars), mixed('markdown', 'g-2', mdChars), mixed('yaml', 'g-yaml', 100),
    ]);
    expect(g.highlighted).toEqual([...rep(true, tsCount + mdCount), false]);
  }, 120000);
});

// D-7574 (ARCH-05): the page store's seed reads the renderer's grammar facts (`codeLanguage`, `inScanPageBudget`,
// `inMarkdownPageBudget`, from `highlightNames.ts`) for every `pre`. These rows hold its decisions across the three
// budgets with the aliases `ts`, `tsx` and `md`, the class shapes the reader takes, and a name no grammar registers.
// Literal sizes, never the imported constants, so a mutated constant reds a behaviour case. Re-derived on raw lengths
// and on each grammar's own block cap (W5h-a, refinement (j)).
describe('D-7574 characterization: highlight decisions across the three budgets, with the aliases ts, tsx and md', () => {
  it('C1 the general budget refuses every alias past it: python 524 288, then tsx, md and ts of one character each', () => {
    expect(decisions(root([...spreadLang('python', 524288, 65536), lang('tsx', 1), lang('md', 1), lang('ts', 1)])))
      .toEqual([...rep(A, 8), INPUT, INPUT, INPUT]);
  });

  it('C2 a tsx block fills the scan sum, at and past the boundary', () => {
    expect(decisions(root([...spreadLang('tsx', 393216, 8192), lang('ts', 1)]))).toEqual([...rep(A, 48), SCAN]);
    expect(decisions(root([...spreadLang('tsx', 393215, 8192), lang('ts', 1), lang('tsx', 1)]))).toEqual([...rep(A, 48), A, SCAN]);
  });

  it('C3 the canonical names and js count in the scan sum, json does not', () => {
    expect(decisions(root([...spreadLang('typescript', 196608, 8192), ...spreadLang('javascript', 196608, 8192), lang('js', 1), lang('json', 1)])))
      .toEqual([...rep(A, 48), SCAN, A]);
  });

  it('C4 the language is read from the code class: case-folded, from a string className, and the first language- wins', () => {
    expect(decisions(root([...spread(['hljs', 'language-TSX'], 393216, 8192), lang('ts', 1)]))).toEqual([...rep(A, 48), SCAN]);
    expect(decisions(root([...spread('language-ts', 393216, 8192), lang('tsx', 1)]))).toEqual([...rep(A, 48), SCAN]);
    expect(decisions(root([...spread(['language-md', 'language-ts'], 131072, 65536), lang('md', 1), lang('ts', 1)])))
      .toEqual([A, A, MARKDOWN, A]);
  });

  it('C5 an md block fills the markdown sum, and ts and tsx are untouched by it', () => {
    expect(decisions(root([...spreadLang('md', 131072, 65536), lang('tsx', 1), lang('ts', 1), lang('md', 1)])))
      .toEqual([A, A, A, A, MARKDOWN]);
  });

  it('C6 a name no grammar registers is no requestable block: it counts in no sum', () => {
    expect(decisions(root([block(['language-nope'], 'x'.repeat(400000)), lang('ts', 1), lang('md', 1)]))).toEqual(['unregistered', A, A]);
  });

  it('C7 both sub-budgets full fill the page exactly, and every later block is refused', () => {
    expect(decisions(root([...spreadLang('ts', 393216, 8192), ...spreadLang('md', 131072, 65536), lang('yaml', 1), lang('tsx', 1), lang('md', 1)])))
      .toEqual([...rep(A, 48 + 2), INPUT, INPUT, INPUT]);
  });
});

// D-7574 (ARCH-05): the Docs page's composition root (`DocMarkdown`) seeds the page's store from its tree. Every other
// row of this file reads the seed directly, so none can see the root; this one renders through `DocMarkdown`, and a root
// that seeds nothing reds it (a block past a budget would be requested).
describe('D-7574: the Docs page hands detachUrls the real highlight-budget languages', () => {
  it('through DocMarkdown, a tsx block past the scan budget and an md block past the markdown budget are never requested and keep their bare labels', async () => {
    const small = lang('tsx', 12);
    const scan = await drawn(root([...spreadLang('ts', 393216, 8192), small, fence('import a\n')]));
    const smallRaw = codeBlocksOf(root([small]))[0]!.raw;
    expect(scan.docs.calls.some((c) => c.code === smallRaw)).toBe(false);
    const scanLabels = [...scan.container.querySelectorAll('.code-block-lang')].map((l) => l.textContent);
    expect(scanLabels.slice(-2)).toEqual(['TSX', 'Python']);
    const scanKeywords = [...scan.container.querySelectorAll('.code-block')].map((b) => b.querySelectorAll('.hljs-keyword').length);
    expect(scanKeywords.slice(-2)).toEqual([0, 1]);
    cleanup();
    const mdSmall = lang('md', 12);
    const markdown = await drawn(root([...spreadLang('md', 131072, 65536), mdSmall, block(['language-yaml'], '# c\n')]));
    const mdRaw = codeBlocksOf(root([mdSmall]))[0]!.raw;
    expect(markdown.docs.calls.some((c) => c.code === mdRaw)).toBe(false);
    const labels = [...markdown.container.querySelectorAll('.code-block-lang')].map((l) => l.textContent);
    expect(labels.slice(-2)).toEqual(['Markdown', 'YAML']);
    expect([...markdown.container.querySelectorAll('.code-block')].at(-1)!.querySelectorAll('.hljs-comment')).toHaveLength(1);
  }, 120000);
});

// F1 (review 1364): the page ceilings count every DRAWN copy of a shared block. One job still serves the key; each copy
// is drawn from the key's entry until a ceiling, and a copy past it is plain and labelled as skipped by it. Rendered
// through `DocMarkdown`: the copies the store seeded are the `pre` elements `CodeBlock` receives as `node`.
describe('F1: a page of copies of one block, the ceilings counting every drawn copy (end to end through DocMarkdown)', () => {
  /** A highlighter that answers every request with `html` at once, in kind: the case measures the count, not the grammar. */
  const answering = (html: string): InThreadHighlighter => {
    const h: InThreadHighlighter = {
      calls: [],
      signals: [],
      state: 'live',
      highlight(request, o) {
        h.calls.push(request);
        h.signals.push(o.signal);
        o.onPosted?.();
        return Promise.resolve<HighlightOutcome>({ kind: 'html', html, mode: 'block' });
      },
      status: () => h.state,
      prewarm: () => undefined,
      release: () => undefined,
    };
    return h;
  };
  /** Per copy: whether it draws spans, and its label. */
  const read = (c: HTMLElement): { coloured: boolean[]; labels: string[] } => ({
    coloured: [...c.querySelectorAll('.code-block')].map((b) => b.querySelector('code.hljs span[class^="hljs-"]') !== null),
    labels: [...c.querySelectorAll('.code-block-lang')].map((l) => l.textContent ?? ''),
  });

  it('the HTML ceiling: copies of one fence whose HTML together passes the page cap are coloured up to it, the rest are plain and say so; one job', async () => {
    const html = `<span class="hljs-keyword">${'x'.repeat(MD_HIGHLIGHT_MAX_HTML_CHARS - 40)}</span>`;
    expect(html.length).toBeLessThan(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS);
    const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS / html.length);
    const n = fit + 3;
    const { container, docs } = await drawn(root(Array.from({ length: n }, () => fence('import a\n'))), answering(html));
    expect(docs.calls).toHaveLength(1);
    // The HTML the drawn copies insert, summed over EVERY copy that carries highlight spans (review 1366 F3: a sum
    // sliced to the copies the ceiling admits could not fail), is within the ceiling. Asserted before the per-copy
    // checks, so a ceiling that admits one copy too many fails here first.
    const inserted = [...container.querySelectorAll('pre > code.hljs')]
      .filter((c) => c.querySelector('span[class^="hljs-"]') !== null)
      .reduce((sum, c) => sum + c.innerHTML.length, 0);
    expect(inserted, 'inserted HTML within the ceiling').toBeLessThanOrEqual(DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS);
    const { coloured, labels } = read(container);
    expect(coloured).toEqual([...rep(true, fit), ...rep(false, n - fit)]);
    expect(labels).toEqual([...rep('Python', fit), ...rep('Python · not highlighted (page highlighting limit)', n - fit)]);
    for (const code of [...container.querySelectorAll('pre > code')].slice(fit)) expect(code.textContent).toBe('import a');
  }, 60000);

  it('the input ceiling: copies of one fence whose raw text together passes the page cap are coloured up to it, the rest are plain and say so; one job', async () => {
    const raw = body(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1, 0);
    const fit = Math.floor(DOCS_HIGHLIGHT_PAGE_MAX_CHARS / MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    const n = fit + 2;
    const { container, docs } = await drawn(root(Array.from({ length: n }, () => fence(raw))));
    expect(docs.calls).toHaveLength(1);
    const { coloured, labels } = read(container);
    expect(coloured).toEqual([...rep(true, fit), ...rep(false, n - fit)]);
    expect(labels).toEqual([...rep('Python', fit), ...rep('Python · not highlighted (page highlighting limit)', n - fit)]);
  }, 60000);

  it('the scan budget: copies of one typescript fence past the scan sum are plain and keep the bare label (part 1\'s ceiling is not the page\'s)', async () => {
    const raw = filler(MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS);
    const fit = Math.floor(DOCS_HIGHLIGHT_SCAN_PAGE_MAX_CHARS / MD_HIGHLIGHT_JS_BLOCK_MAX_CHARS);
    const n = fit + 2;
    const { container, docs } = await drawn(root(Array.from({ length: n }, () => block(['language-ts'], raw))), answering('<span class="hljs-comment">c</span>'));
    expect(docs.calls).toHaveLength(1);
    const { coloured, labels } = read(container);
    expect(coloured).toEqual([...rep(true, fit), ...rep(false, n - fit)]);
    expect(labels).toEqual(rep('TypeScript', n));
  }, 60000);
});
