// Docs W5 part 1, Task 6: the page highlight budget (spec 2026-10-01 4.10 "Highlighting"; M4.H2; refinement (h)),
// rewritten by W5h-a Task 6 (refinement (j)): the decisions moved from `detachUrls` into the page store's seed
// (`highlightStore.ts`). The store sums each requestable block, repeats included (D-7762), in document order, over
// its raw text (one trailing newline stripped, as `CodeBlock` strips it), and a key past the one ceiling at seed,
// `skipped:page-input`, is `skipped` from the first commit; part 1's two sub-budgets retired in W5h-b. A block over
// the block cap, or in no registered grammar, is no requestable block and counts nothing. The trees are built by
// hand, exactly as the parse emits a fenced block, so no case parses half a megabyte; every block of a boundary case
// is distinct (the repeated-copy cases below say so). The rendered cases draw `DocMarkdown` under a production store
// over an in-thread highlighter, so the page's seed, requests and check are the shipped ones.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Element as HastElement, Root as HastRoot } from 'hast';
import { HighlighterContext, createProductionStore } from '../src/lib/highlighterContext';
import { codeBlocksOf, type HighlightStore, type SkipCeiling } from '../src/lib/highlightStore';
import { PreHighlightContext, SHARED_COMPONENTS, codeBlockLabel } from '../src/lib/markdown';
import {
  DOCS_HIGHLIGHT_PAGE_HTML_MAX_CHARS, DOCS_HIGHLIGHT_PAGE_MAX_CHARS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_HTML_CHARS,
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

/** `n` characters of distinct text: lines of 99 `x` and a newline, the last character never a newline. */
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
/** Blocks of class `className` of at most `cap` raw characters each, summing to `total` (the block size, literal). */
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

/** A fenced `python` block as the parse emits it: `pre > code.language-python`, holding `text`. */
const fence = (text: string): HastElement => block(['language-python'], text);

/** `chars` characters of Python holding exactly one keyword, then `x` and a space in turn, broken into lines under
 *  100 characters, then the newline the parse keeps: cheap for highlight.js, so the case measures the decision, not
 *  the grammar. `i` makes it distinct (`import a<i> = 1`), its length unchanged. */
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

// W5h-b (M4.H23): part 1's scan and markdown page budgets are retired. Every grammar's code counts only against the
// page input ceiling, DOCS_HIGHLIGHT_PAGE_MAX_CHARS, in document order (M4.H12). Literal sizes, so a mutated
// constant reds a behaviour case.
describe('W5h-b: the scan and markdown page budgets are retired; every grammar counts only against the page input ceiling', () => {
  it('64 ts blocks of 8 192 characters (exactly 524 288) are all admitted; one more ts character is skipped by the input ceiling', () => {
    expect(decisions(root([...spreadLang('ts', 524288, 8192), lang('ts', 1)]))).toEqual([...rep(A, 64), INPUT]);
  });

  it('eight markdown and md blocks of 65 536 characters are all admitted; one more md character is skipped by the input ceiling', () => {
    expect(decisions(root([...spreadLang('markdown', 262144, 65536), ...spreadLang('md', 262144, 65536), lang('md', 1)])))
      .toEqual([...rep(A, 8), INPUT]);
  });

  it('tsx, jsx and rs blocks fill the page together, past what the scan budget allowed, and the next block of any grammar is skipped', () => {
    expect(decisions(root([
      ...spreadLang('tsx', 196608, 8192), ...spreadLang('jsx', 196608, 8192), ...spreadLang('rs', 131072, 4096), lang('yaml', 1),
    ]))).toEqual([...rep(A, 24 + 24 + 32), INPUT]);
  });

  it('a ts block over 8 192 characters and a rust block over 4 096 each have a key: part 1\'s grammar caps are gone', () => {
    expect(decisions(root([lang('ts', 8193), lang('rust', 4097), lang('tsx', 65536)]))).toEqual([A, A, A]);
  });
});

// Review 460 F10 asked for the end-to-end page "under the target" as a timed reading; a wall-clock assertion is
// load-sensitive on a shared box, so this case replaces it with the decision itself: which blocks of a mixed crafted
// page the page store admits and colours, and which it refuses, under the page input ceiling, read from the rendered page (the
// page is drawn through `DocMarkdown` over an in-thread highlighter). The timings of the same pages are recorded in the
// plan's results (review 460 F10).
describe('review 460 F10: which blocks of a mixed crafted page are highlighted, end to end', () => {
  /** One block's text as the parse leaves it: `chars` raw characters (a first line naming `tag` so every block is unique,
   *  then `unit` lines, cheap for highlight.js), then the newline it keeps. */
  const text = (tag: string, comment: string, unit: string, chars: number): string =>
    (`${comment} ${tag}\n` + unit.repeat(Math.ceil(chars / unit.length))).slice(0, chars) + '\n';
  // One comment, key or heading per 92-character line: highlightable, few elements per block (the case holds about a
  // megabyte of code, rendered).
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

  it('end to end through the page store and CodeBlock: a mixed crafted page highlights exactly the blocks the page input ceiling admits', async () => {
    // Literal sizes: 48 ts blocks of 8 192 and two markdown blocks of 65 536 fill the page input ceiling exactly.
    const tsChars = 8192;
    const mdChars = 65536;
    const tsCount = 48;
    const mdCount = 2;
    expect(tsCount * tsChars + mdCount * mdChars).toBe(DOCS_HIGHLIGHT_PAGE_MAX_CHARS);
    const tsFill = (): { name: string; text: string }[] => Array.from({ length: tsCount }, (_, i) => mixed('ts', `fill ${i}`, tsChars));

    // Page S: 48 ts blocks, then tsx, yaml, javascript, rust and a ts block of 8 193: all within the page, all coloured.
    const s = await run([
      ...tsFill(),
      mixed('tsx', 's-tsx', 100), mixed('yaml', 's-yaml', 100), mixed('javascript', 's-js', 100), mixed('rust', 's-rust', 100),
      mixed('ts', 's-over', tsChars + 1),
    ]);
    expect(s.highlighted).toEqual(rep(true, tsCount + 5));
    expect(s.labels.filter((l) => l.includes('not highlighted'))).toEqual([]);

    // Page M: two markdown blocks of 65 536, then a small markdown and a yaml block: all within the page, all coloured.
    const m = await run([
      mixed('markdown', 'm-1', mdChars), mixed('md', 'm-2', mdChars), mixed('markdown', 'm-3', 100), mixed('yaml', 'm-yaml', 100),
    ]);
    expect(m.highlighted).toEqual([true, true, true, true]);

    // Page G, the page input ceiling (the accepted residue's page): 48 ts blocks and two markdown blocks fill it exactly,
    // all 50 highlighted; the yaml block after them is refused by the page input ceiling.
    const g = await run([
      ...tsFill(), mixed('markdown', 'g-1', mdChars), mixed('markdown', 'g-2', mdChars), mixed('yaml', 'g-yaml', 100),
    ]);
    expect(g.highlighted).toEqual([...rep(true, tsCount + mdCount), false]);
  }, 120000);
});

// D-7574 (ARCH-05): the page store's seed reads the renderer's grammar facts (`codeLanguage` and `isRegisteredGrammar`,
// from `highlightNames.ts`) for every `pre`. These rows hold its decisions at the page input ceiling with the aliases
// `ts`, `tsx` and `md`, the class shapes the reader takes, and a name no grammar registers. Literal sizes, never the
// imported constants, so a mutated constant reds a behaviour case. Re-derived on raw lengths (W5h-a, refinement (j)).
describe('D-7574 characterization: highlight decisions at the page input ceiling, with the aliases ts, tsx and md', () => {
  it('C1 the page input ceiling refuses every alias past it: python 524 288, then tsx, md and ts of one character each', () => {
    expect(decisions(root([...spreadLang('python', 524288, 65536), lang('tsx', 1), lang('md', 1), lang('ts', 1)])))
      .toEqual([...rep(A, 8), INPUT, INPUT, INPUT]);
  });

  it('C4 the language is read from the code class: case-folded, from a string className, and the first language- wins', () => {
    expect(codeBlocksOf(root([block(['hljs', 'language-TSX'], 'a'), block('language-ts', 'b'), block(['language-md', 'language-ts'], 'c')]))
      .map((b) => b.lang)).toEqual(['tsx', 'ts', 'md']);
  });

  // 524 288 characters, the whole page input ceiling: were they counted, the ts and md blocks after them would pass it.
  it('C6 a name no grammar registers is no requestable block: it is never seeded, and counts in no page sum', () => {
    expect(decisions(root([block(['language-nope'], 'x'.repeat(524288)), lang('ts', 1), lang('md', 1)]))).toEqual(['unregistered', A, A]);
  });

  it('C7 ts and md blocks filling the page exactly, and every later block is refused', () => {
    expect(decisions(root([...spreadLang('ts', 393216, 8192), ...spreadLang('md', 131072, 65536), lang('yaml', 1), lang('tsx', 1), lang('md', 1)])))
      .toEqual([...rep(A, 48 + 2), INPUT, INPUT, INPUT]);
  });
});

// D-7574 (ARCH-05): the Docs page's composition root (`DocMarkdown`) seeds the page's store from its tree. Every other
// row of this file reads the seed directly, so none can see the root; this one renders through `DocMarkdown`, and a root
// that seeds nothing reds it (a block past the page input ceiling would be requested).
describe('D-7574: the Docs page seeds its store from the tree it draws', () => {
  it('through DocMarkdown, a tsx block and an md block past the page input ceiling are never requested and say so', async () => {
    const tsx = lang('tsx', 12);
    const md = lang('md', 12);
    const page = await drawn(root([...spreadLang('python', 524288, 65536), tsx, md]));
    const raws = codeBlocksOf(root([tsx, md])).map((b) => b.raw);
    expect(page.docs.calls.some((c) => raws.includes(c.code))).toBe(false);
    const labels = [...page.container.querySelectorAll('.code-block-lang')].map((l) => l.textContent);
    expect(labels.slice(-2)).toEqual(['TSX · not highlighted (page highlighting limit)', 'Markdown · not highlighted (page highlighting limit)']);
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
});

// The label of a skipped block names the page, whichever of the four page ceilings skipped it (section 4.10's table).
describe('M4.H12 label: every page ceiling skips under the one label "page highlighting limit"', () => {
  it('page-input, page-output, page-timeouts and page-worker-time each read "Python · not highlighted (page highlighting limit)"', () => {
    const ceilings: readonly SkipCeiling[] = ['page-input', 'page-output', 'page-timeouts', 'page-worker-time'];
    expect(ceilings.map((ceiling) => codeBlockLabel('Python', 'import a\n', { kind: 'key', key: 'python\u0000import a' }, { kind: 'skipped', ceiling })))
      .toEqual(rep('Python · not highlighted (page highlighting limit)', 4));
  });
});
