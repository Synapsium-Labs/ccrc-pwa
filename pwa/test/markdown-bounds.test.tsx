// Docs W5 part 1, Task 3: the bounds on the shared Markdown pipeline (spec 2026-10-01 section 4.10's "Bounds on the
// shared components" and section 4.12's chat clause; the plan's refinements (d), (e), (f) and (g); the coordinator's
// ruling of 2026-10-13: each bound carries a case here and a mutation row, by name).
//   r11: `keystrokeParts` answers `null` for a span longer than `MD_KEYSTROKE_MAX_CHARS` before it trims or splits
//        (the split's pattern backtracks over a run of whitespace).
//   2-2: the parse's element count includes the chips `SHARED_COMPONENTS.code` draws for inline code, so `too-wide`
//        fires in the parse, before anything renders, for docs and for chat's worker path alike.
// r10, and the word, line, whitespace and per-grammar bounds part 1 set beside it, retired in W5h-b (M4.H23):
// highlight.js runs only in the highlight worker, under its per-block deadline (M4.H7). The first describe shows each
// shape they refused is now requested whole; the last holds the xml subLanguage strip, which stays.
// Every parse here is `parseMarkdown`, the function the worker runs; chat's worker path gets it through an injected
// parser. The colours of a block come from the highlight worker's grammars; here, from the synchronous test store.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { Root as HastRoot } from 'hast';
import { ChatMarkdown, CodeBlock, PreHighlightContext, SHARED_COMPONENTS } from '../src/lib/markdown';
import { HLJS } from '../src/lib/highlightGrammars';
import { createProductionStore } from '../src/lib/highlighterContext';
import { inThreadHighlighter, withSyncHighlight, withSyncStore } from './highlightTestStore';
import { keystrokeParts, utf8ByteLength } from '../src/lib/markdownGuard';
import { CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_HIGHLIGHT_MAX_HTML_CHARS, MD_KEYSTROKE_MAX_CHARS } from '../src/lib/markdownLimits';
import { inlineCodeExtraElements, parseMarkdown, type MarkdownProfile } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { renderHast } from '../src/lib/renderHast';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** One fenced block, as react-markdown hands it to the `pre` component. */
function block(lang: string, body: string): HTMLElement {
  return render(withSyncStore(
    <CodeBlock>
      <code className={`language-${lang}`}>{`${body}\n`}</code>
    </CodeBlock>,
  )).container;
}

const label = (c: HTMLElement): string | null | undefined => c.querySelector('.code-block-lang')?.textContent;

/** The tree `parseMarkdown` gives `src`, or a thrown error naming the outcome that was not a tree. */
function treeOf(src: string, profile: MarkdownProfile): HastRoot {
  const o = parseMarkdown(src, profile);
  if (o.kind !== 'tree') throw new Error(`not a tree: ${JSON.stringify(o)}`);
  return o.tree;
}

/** Chat's Markdown for `text` through an injected parser that answers what the worker would, settled. */
async function chat(text: string) {
  const parser = vi.fn<MarkdownParser>((src, opts) => Promise.resolve(parseMarkdown(src, opts.profile)));
  const r = render(withSyncHighlight(<div className="msg-assist"><ChatMarkdown text={text} parser={parser} /></div>));
  await act(async () => {
    await Promise.resolve();
  });
  return { ...r, parser };
}

/** A chord of `n` single-character parts: `a+a+...+a`, 2n - 1 characters. */
const chord = (n: number): string => `${'a+'.repeat(n - 1)}a`;
/** `n` inline code spans of `span`, one paragraph. */
const spans = (n: number, span: string): string => Array.from({ length: n }, () => `\`${span}\``).join(' ');

// W5h-b (base spec 2026-10-01 section 4.9 "W5 part 1's highlight bounds under W5h", M4.H23): part 1's word, line and
// whitespace bounds and its per-grammar block caps are retired. A block of each shape they refused now has a key, is
// requested whole and once, and shows its bare label while it waits; the worker's per-block deadline is its bound
// (M4.H7, `markdown-runner.test.ts`). The highlighter holds every request, so no crafted shape runs through
// highlight.js here.
describe('W5h-b: a block of a shape part 1 refused is requested whole, under its bare label (M4.H23)', () => {
  const RETIRED_SHAPES: ReadonlyArray<readonly [string, string, string, string]> = [
    ['a 257-character identifier (the word bound)', 'ts', 'TypeScript', `const ${'a'.repeat(257)} = 1;`],
    ['a 32 768-character identifier in python (the word bound)', 'python', 'Python', 'a'.repeat(32768)],
    ['a 2 049-character line of "[" in markdown (the line bound)', 'markdown', 'Markdown', '['.repeat(2049)],
    ['2 049 newlines in typescript (the whitespace bound)', 'ts', 'TypeScript', `a${'\n'.repeat(2049)}b`],
    ['8 193 characters of typescript (its grammar cap)', 'ts', 'TypeScript', 'const a = 1;\n'.repeat(631).slice(0, 8193)],
    ['4 097 characters of rust (its grammar cap)', 'rust', 'Rust', 'let a = 1;\n'.repeat(373).slice(0, 4097)],
  ];

  it.each(RETIRED_SHAPES)('%s: one request with the whole text, and the bare label while it waits', async (_name, lang, label, body) => {
    const h = inThreadHighlighter({ hold: true });
    const store = createProductionStore(h, 'docs');
    const { container } = render(
      <PreHighlightContext value={store}><CodeBlock><code className={`language-${lang}`}>{`${body}\n`}</code></CodeBlock></PreHighlightContext>,
    );
    await waitFor(() => expect(h.calls).toHaveLength(1));
    expect(h.calls[0]).toMatchObject({ lang, code: body });
    expect(container.querySelector('.code-block-lang')?.textContent).toBe(label);
  });
});

describe('W5 bound r11: a code span longer than MD_KEYSTROKE_MAX_CHARS is never a chord', () => {
  it('keystrokeParts answers null for a whitespace flood before it trims or splits', () => {
    const raw = `a${' '.repeat(80000)}b`;
    const split = vi.spyOn(String.prototype, 'split').mockImplementation(() => ['a', 'b']);
    const trim = vi.spyOn(String.prototype, 'trim');
    const got = keystrokeParts(raw);
    const splits = split.mock.calls.length;
    const trims = trim.mock.calls.length;
    split.mockRestore();
    trim.mockRestore();
    expect(got).toBeNull();
    expect(splits).toBe(0);
    expect(trims).toBe(0);
  });

  it('control: the 80 000-space flood answers in under a second', () => {
    const t = performance.now();
    expect(keystrokeParts(`a${' '.repeat(80000)}b`)).toBeNull();
    expect(performance.now() - t).toBeLessThan(1000);
  }, 60_000);

  it('a 64-character chord still draws chips; a 65-character one is plain inline code', () => {
    const at = `Esc+${'a+'.repeat(29)}Fn`;
    const over = `Esc+${'a+'.repeat(29)}Tab`;
    expect([at.length, over.length]).toEqual([MD_KEYSTROKE_MAX_CHARS, MD_KEYSTROKE_MAX_CHARS + 1]);
    expect(keystrokeParts(at)).toHaveLength(31);
    expect(keystrokeParts(over)).toBeNull();
    const chips = render(withSyncStore(renderHast(treeOf(`Press \`${at}\` now.`, 'docs'), { components: SHARED_COMPONENTS }))).container;
    expect(chips.querySelectorAll('kbd')).toHaveLength(31);
    cleanup();
    const plain = render(withSyncStore(renderHast(treeOf(`Press \`${over}\` now.`, 'docs'), { components: SHARED_COMPONENTS }))).container;
    expect(plain.querySelectorAll('kbd')).toHaveLength(0);
    expect(plain.querySelector('code.md-code')?.textContent).toBe(over);
  });

  it("W4's measured shape, 50 chords of 2 048 parts, is plain code now and parses as a tree", () => {
    const long = chord(2048);
    expect(keystrokeParts(long)).toBeNull();
    expect(inlineCodeExtraElements(long)).toBe(0);
    expect(parseMarkdown(spans(50, long), 'docs').kind).toBe('tree');
  });
});

describe("W5 bound 2-2: the parse's element count includes the chips inline code draws", () => {
  // A 31-plus chord: 32 single-character parts, 63 characters, so within r11. One span draws `span.kbd-combo`,
  // 32 `kbd` and 31 `span.kbd-plus` (64 elements) where the walk counted one `code`.
  const CHORD = chord(32);
  const PER_SPAN = 2 * 32;

  it('inlineCodeExtraElements: a chord of N parts adds 2N - 1, a named key 1, anything else 0', () => {
    expect(inlineCodeExtraElements('Ctrl+Shift+P')).toBe(5);
    expect(inlineCodeExtraElements('Esc')).toBe(1);
    expect(inlineCodeExtraElements(CHORD)).toBe(PER_SPAN - 1);
    expect(inlineCodeExtraElements('npm test')).toBe(0);
    expect(inlineCodeExtraElements('')).toBe(0);
    expect(inlineCodeExtraElements(chord(33))).toBe(0);
  });

  it.each<MarkdownProfile>(['docs', 'chat'])('400 spans of a 31-plus chord are too-wide in the %s profile, before any render', (profile) => {
    expect(parseMarkdown(spans(400, CHORD), profile)).toEqual({ kind: 'too-wide', elements: 1 + 400 * PER_SPAN });
  });

  it('300 such spans are a tree, and the DOM it draws holds exactly the counted elements', () => {
    const tree = treeOf(spans(300, CHORD), 'docs');
    const { container } = render(withSyncStore(renderHast(tree, { components: SHARED_COMPONENTS })));
    expect(container.querySelectorAll('kbd')).toHaveLength(300 * 32);
    expect(container.querySelectorAll('*')).toHaveLength(1 + 300 * PER_SPAN);
    expect(1 + 300 * PER_SPAN).toBeLessThanOrEqual(DOCS_MAX_RENDER_ELEMENTS);
  });

  it("code under pre is CodeBlock's and never chips: 400 fenced blocks holding the chord are a tree", () => {
    expect(parseMarkdown(`\`\`\`\n${CHORD}\n\`\`\`\n\n`.repeat(400), 'docs').kind).toBe('tree');
  });

  it("chat's worker path shows the flood as plain text with the too-wide note, drawing no chip", async () => {
    const text = spans(400, CHORD);
    expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const { container } = await chat(text);
    expect(container.querySelector('pre.msg-plain')?.textContent).toBe(text);
    expect(container.querySelector('p.msg-plain-note')?.textContent)
      .toBe(`Shown as plain text: this message would draw ${1 + 400 * PER_SPAN} elements (limit ${DOCS_MAX_RENDER_ELEMENTS}).`);
    expect(container.querySelectorAll('kbd')).toHaveLength(0);
  });
});

describe('the xml subLanguage strip, kept by W5h-b (M4.H23): xml carries no sub-language inside <script> or <style>', () => {
  // `xml` is registered WITHOUT its script and style sub-languages (highlight.js's xml is quadratic on those regions
  // whatever they embed); the strip stays after W5h-b. Literal sizes, never the imported constants.
  const shape = (unit: string, n: number, chars: number): string => {
    const line = unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    return Array.from({ length: Math.ceil(chars / (line.length + 1)) + 1 }, () => line).join('\n').slice(0, chars);
  };
  /** `'<script>\n'`, then `<a>` in lines of 1 800 characters, `chars` in all. */
  const scripted = (chars: number): string => `<script>\n${shape('<a>', 1800, chars - 9)}`;

  // The walk below shares nothing with the module: it follows EVERY object-valued property of a grammar's definition
  // (not just `contains`, `variants` and `starts`), whatever depth, and reads `subLanguage` as a string or an array.
  // An EMPTY array is highlight.js's auto-detect across every registered grammar, so it reaches them all.
  const subLanguagesOf = (root: object, every: readonly string[]): Set<string> => {
    const found = new Set<string>();
    const seen = new Set<object>();
    const todo: object[] = [root];
    while (todo.length > 0) {
      const node = todo.pop()!;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const [key, value] of Object.entries(node)) {
        if (key === 'parent') continue;
        if (key === 'subLanguage') {
          if (Array.isArray(value) && value.length === 0) for (const name of every) found.add(name);
          for (const name of typeof value === 'string' ? [value] : Array.isArray(value) ? value : []) {
            if (typeof name === 'string') found.add(name);
          }
        } else if (typeof value === 'object' && value !== null) {
          todo.push(value);
        }
      }
    }
    return found;
  };
  it('the registered xml carries no subLanguage on any mode (script and style contents are one plain run), and every alias of xml is that grammar', () => {
    const xmlDef = HLJS.getLanguage('xml')!;
    expect([...subLanguagesOf(xmlDef, [])]).toEqual([]);
    // Compiled or not: highlight once, then read again.
    HLJS.highlight('<script>a</script><style>a{}</style>', { language: 'xml', ignoreIllegals: true });
    expect([...subLanguagesOf(xmlDef, [])]).toEqual([]);
    const aliases = (xmlDef as { aliases?: string[] }).aliases ?? [];
    expect(aliases).toEqual(expect.arrayContaining(['html', 'svg']));
    for (const alias of [...aliases, 'html', 'svg']) expect(HLJS.getLanguage(alias)).toBe(xmlDef);
  });

  // Real highlight.js, no spy: `CodeBlock` highlights these blocks, and a script or style body carries no JS or CSS span.
  const real = (lang: string, body: string): HTMLElement => block(lang, body);
  const HLJS_SPANS = /hljs-(keyword|selector-tag|attribute|built_in|title|string|number|literal|property|variable)/;
  const shapes: [string, (chars: number) => string][] = [
    ['<script> one per line', (n) => shape('<script>', 8, n)],
    ['<script><a> one per line', (n) => shape('<script><a>', 11, n)],
    ['<style>{ one per line', (n) => shape('<style>{', 8, n)],
  ];

  it.each(
    ['xml', 'html'].flatMap((lang) => shapes.flatMap(([name, make]) => [8192, 65536].map((n) => [lang, name, n, make] as const))),
  )('a %s block of %s at %i characters is highlighted (within the 64 KiB cap), its script and style contents unspanned', (lang, _name, n, make) => {
    const body = make(n);
    const c = real(lang, body);
    expect(label(c)).not.toMatch(/not highlighted/);
    expect(c.querySelector('code')!.textContent).toBe(body);
    expect(c.querySelector('code')!.innerHTML).toMatch(/hljs-tag/);
    expect(c.querySelector('code')!.innerHTML).not.toMatch(HLJS_SPANS);
  });

  it.each(
    ['markdown', 'md'].flatMap((lang) => shapes.map(([name, make]) => [lang, name, 8192, make] as const)),
  )('a %s block holding HTML, shape %s at %i characters, is highlighted', (lang, _name, n, make) => {
    const c = real(lang, make(n));
    expect(label(c)).not.toMatch(/not highlighted/);
    expect(c.querySelector('code')!.textContent).toBe(make(n));
  });

  // W5h-b: R19 set the per-block HTML cap (MD_HIGHLIGHT_MAX_HTML_CHARS) to 1 048 576. At 65 536 characters the markup of
  // all three shapes measures within it (356 874, 502 514 and 356 877 characters), so each is coloured; each case
  // measures its own markup against the cap first, so a shape that grows past it fails there.
  it.each(
    ['markdown', 'md'].flatMap((lang) => shapes.map(([name, make]) => [lang, name, 65536, make] as const)),
  )('a %s block holding HTML, shape %s at %i characters, is highlighted under the measured HTML cap', (lang, _name, n, make) => {
    const body = make(n);
    expect(HLJS.highlight(body, { language: 'markdown', ignoreIllegals: true }).value.length).toBeLessThanOrEqual(MD_HIGHLIGHT_MAX_HTML_CHARS);
    const c = real(lang, body);
    expect(label(c)).not.toMatch(/not highlighted/);
    expect(c.querySelector('code')!.textContent).toBe(body);
    expect(c.querySelector('code span')).not.toBeNull();
  });

  it('a 64 KiB xml, html and svg block of <script> then <a> lines IS highlighted; the body of the script is plain; the markdown block of the same shape is highlighted under the measured HTML cap', () => {
    for (const lang of ['xml', 'html', 'svg']) {
      const body = scripted(65536);
      expect(body).toHaveLength(65536);
      const c = real(lang, body);
      expect(label(c)).not.toMatch(/not highlighted/);
      expect(c.querySelector('code')!.innerHTML).not.toMatch(HLJS_SPANS);
      cleanup();
    }
    // The markdown arm: its markup measures within the per-block HTML cap, so it is coloured.
    const body = scripted(65536);
    expect(HLJS.highlight(body, { language: 'markdown', ignoreIllegals: true }).value.length).toBeLessThanOrEqual(MD_HIGHLIGHT_MAX_HTML_CHARS);
    const md = real('markdown', body);
    expect(label(md)).not.toMatch(/not highlighted/);
    expect(md.querySelector('code span')).not.toBeNull();
    cleanup();
    // Over 64 KiB it is refused as for any grammar.
    expect(label(real('xml', scripted(65537)))).toMatch(/· not highlighted \(65 KiB\)$/);
  });

  it('markup outside script and style is still coloured', () => {
    const c = real('html', '<html><body class="a">hi</body></html>');
    const html = c.querySelector('code')!.innerHTML;
    expect(html).toMatch(/hljs-tag/);
    expect(html).toMatch(/hljs-name/);
    expect(html).toMatch(/hljs-attr/);
  });

  it('an html fence with a script and a style carries no keyword, selector or attribute span inside them', () => {
    const c = real('html', '<script>let a = 1;</script><style>a { color: red }</style>');
    const html = c.querySelector('code')!.innerHTML;
    expect(html).not.toMatch(/hljs-keyword/);
    expect(html).not.toMatch(/hljs-selector-tag/);
    expect(html).not.toMatch(/hljs-attribute/);
    expect(c.querySelector('code')!.textContent).toBe('<script>let a = 1;</script><style>a { color: red }</style>');
  });
});
