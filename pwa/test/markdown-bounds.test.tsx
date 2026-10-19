// Docs W5 part 1, Task 3: the three bounds on the shared Markdown pipeline (spec 2026-10-01 section 4.10's "Bounds
// on the shared components" and section 4.12's chat clause; the plan's refinements (d), (e), (f) and (g); the
// coordinator's ruling of 2026-10-13: each bound carries a case here and a mutation row, by name).
//   r10: `CodeBlock` never asks highlight.js to colour a block holding a run of `[A-Za-z0-9_$]` longer than
//        `MD_HIGHLIGHT_MAX_WORD_CHARS` (one such run costs the square of its length in four grammars).
//   r11: `keystrokeParts` answers `null` for a span longer than `MD_KEYSTROKE_MAX_CHARS` before it trims or splits
//        (the split's pattern backtracks over a run of whitespace).
//   2-2: the parse's element count includes the chips `SHARED_COMPONENTS.code` draws for inline code, so `too-wide`
//        fires in the parse, before anything renders, for docs and for chat's worker path alike.
// Every parse here is `parseMarkdown`, the function the worker runs; chat's worker path gets it through an injected
// parser. `hljs.highlight` is spied where a case asserts it is not called, and answers nothing, so a red run never
// pays for a long word.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import hljs from 'highlight.js/lib/core';
import type { Root as HastRoot } from 'hast';
import {
  ChatMarkdown, CodeBlock, HIGHLIGHT_BOUNDED_CAPS, SHARED_COMPONENTS, deriveBoundedCaps, highlightBlockCap, inMarkdownPageBudget, inScanPageBudget,
  longestBlankRun, longestWordRun,
} from '../src/lib/markdown';
import { keystrokeParts, utf8ByteLength } from '../src/lib/markdownGuard';
import {
  CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_BLANK_CHARS,
  MD_HIGHLIGHT_MAX_LINE_CHARS, MD_HIGHLIGHT_MAX_WORD_CHARS, MD_KEYSTROKE_MAX_CHARS,
} from '../src/lib/markdownLimits';
import { inlineCodeExtraElements, parseMarkdown, type MarkdownProfile } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { renderHast } from '../src/lib/renderHast';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Spies `hljs.highlight` and answers an empty highlight: a case that counts calls never pays for one. */
const spyHighlight = () =>
  vi.spyOn(hljs, 'highlight').mockReturnValue({ value: '' } as unknown as ReturnType<typeof hljs.highlight>);

/** One fenced block, as react-markdown hands it to the `pre` component. */
function block(lang: string, body: string): HTMLElement {
  return render(
    <CodeBlock>
      <code className={`language-${lang}`}>{`${body}\n`}</code>
    </CodeBlock>,
  ).container;
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
  const r = render(<div className="msg-assist"><ChatMarkdown text={text} parser={parser} /></div>);
  await act(async () => {
    await Promise.resolve();
  });
  return { ...r, parser };
}

/** A chord of `n` single-character parts: `a+a+...+a`, 2n - 1 characters. */
const chord = (n: number): string => `${'a+'.repeat(n - 1)}a`;
/** `n` inline code spans of `span`, one paragraph. */
const spans = (n: number, span: string): string => Array.from({ length: n }, () => `\`${span}\``).join(' ');

describe('W5 bound r10: no highlighting for a block holding a word longer than MD_HIGHLIGHT_MAX_WORD_CHARS', () => {
  it('a ts fence holding a 257-character identifier is not highlighted and says why; 256 is highlighted', () => {
    const highlight = spyHighlight();
    const over = `const ${'a'.repeat(257)} = 1;`;
    const c = block('ts', over);
    expect(highlight).not.toHaveBeenCalled();
    expect(label(c)).toBe('TypeScript · not highlighted (a 257-character word)');
    expect(c.querySelector('pre > code.hljs')?.textContent).toBe(over);
    cleanup();
    const at = block('ts', `const ${'a'.repeat(256)} = 1;`);
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(label(at)).toBe('TypeScript');
  });

  it('a 32 KiB one-identifier python fence through SHARED_COMPONENTS never reaches highlight.js', () => {
    const highlight = spyHighlight();
    const { container } = render(renderHast(treeOf(`\`\`\`python\n${'a'.repeat(32768)}\n\`\`\`\n`, 'docs'), { components: SHARED_COMPONENTS }));
    expect(highlight).not.toHaveBeenCalled();
    expect(label(container)).toBe('Python · not highlighted (a 32768-character word)');
  });

  it("the same fence through chat's worker path (ChatMarkdown, injected parser) never reaches highlight.js", async () => {
    const highlight = spyHighlight();
    const text = `\`\`\`python\n${'a'.repeat(32768)}\n\`\`\`\n`;
    expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const { container, parser } = await chat(text);
    expect(parser).toHaveBeenCalledTimes(1);
    expect(container.querySelector('pre.msg-plain')).toBeNull();
    expect(highlight).not.toHaveBeenCalled();
    expect(label(container)).toBe('Python · not highlighted (a 32768-character word)');
  });

  it('a block over MD_HIGHLIGHT_BLOCK_MAX_CHARS keeps its size label even when it holds a long word', () => {
    const highlight = spyHighlight();
    expect(label(block('ts', 'a'.repeat(70000)))).toBe('TypeScript · not highlighted (69 KiB)');
    expect(highlight).not.toHaveBeenCalled();
  });

  it('an unregistered fence keeps its plain label whatever its words', () => {
    const highlight = spyHighlight();
    expect(label(block('mermaid', 'a'.repeat(300)))).toBe('mermaid');
    expect(highlight).not.toHaveBeenCalled();
  });

  it('ordinary code still highlights', () => {
    const c = block('ts', 'const answer = 42; // the answer');
    expect(label(c)).toBe('TypeScript');
    expect(c.querySelectorAll('.hljs-keyword').length).toBeGreaterThan(0);
  });

  it('longestWordRun counts letters, digits, _, $ and every code unit from 0x7f up, in one pass', () => {
    expect(longestWordRun('')).toBe(0);
    expect(longestWordRun('ab cd')).toBe(2);
    expect(longestWordRun('a_b$c9')).toBe(6);
    expect(longestWordRun('a-b.c')).toBe(1);
    // highlight.js's PHP grammar treats \x7f-\xff as identifier characters, so every unit from 0x7f up is a word
    // unit (fail closed): a run of non-ASCII letters, of astral units and of 0x7f itself is counted.
    expect(longestWordRun('é'.repeat(300))).toBe(300);
    expect(longestWordRun('_é'.repeat(257))).toBe(514);
    expect(longestWordRun('\u{1F600}'.repeat(3))).toBe(6);
    expect(longestWordRun('\x7f\x7f')).toBe(2);
    expect(longestWordRun('~~~')).toBe(0);
    expect(longestWordRun('é - é')).toBe(1);
    expect(longestWordRun(`${'x'.repeat(300)} ${'y'.repeat(5)}`)).toBe(300);
    expect(longestWordRun('Z'.repeat(MD_HIGHLIGHT_MAX_WORD_CHARS + 1))).toBe(257);
  });

  it('a php fence of 257 `_é` units (a 514-character run) is not highlighted and says why', () => {
    // The measured gap: highlight.js's PHP grammar takes \x7f-\xff as identifier characters, and 64 KiB of `_é`
    // cost about 38 s before the class counted every unit from 0x7f up.
    const highlight = spyHighlight();
    const over = '_é'.repeat(257);
    const c = block('php', over);
    expect(highlight).not.toHaveBeenCalled();
    expect(label(c)).toBe('PHP · not highlighted (a 514-character word)');
    expect(c.querySelector('pre > code.hljs')?.textContent).toBe(over);
  });

  it('a run of 256 code units that holds non-ASCII units still highlights; 257 does not', () => {
    const highlight = spyHighlight();
    expect(label(block('php', `${'_é'.repeat(127)}ab`))).toBe('PHP');
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(label(block('php', `${'_é'.repeat(127)}abc`))).toBe('PHP · not highlighted (a 257-character word)');
    expect(highlight).toHaveBeenCalledTimes(1);
  });
});

describe('the line bound: no highlighting for a block holding a line longer than MD_HIGHLIGHT_MAX_LINE_CHARS', () => {
  const MAX = MD_HIGHLIGHT_MAX_LINE_CHARS;
  /** `unit` repeated and cut to `n` characters. */
  const unitLine = (unit: string, n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  /** The largest block `lang` highlights: markdown and yaml keep 64 KiB (xml is registered without its script and
   *  style sub-languages, so markdown reaches no bounded grammar, review 450 F1). */
  const capOf = (_lang: string): number => MD_HIGHLIGHT_BLOCK_MAX_CHARS;
  /** The cap of `lang` (less the last partial line) of lines of `n` characters. */
  const lines = (unit: string, n: number, lang: string): string =>
    Array.from({ length: Math.floor(capOf(lang) / (n + 1)) }, () => unitLine(unit, n)).join('\n');

  it('declares 2048 characters', () => {
    expect(MD_HIGHLIGHT_MAX_LINE_CHARS).toBe(2048);
  });

  it.each([
    ['markdown', '[', 'Markdown'],
    ['markdown', '[a', 'Markdown'],
    ['markdown', '![', 'Markdown'],
    ['yaml', 'a a a ', 'YAML'],
  ])('a %s block of %j lines one character over the bound is not highlighted and says why', (lang, unit, name) => {
    const highlight = spyHighlight();
    const one = unitLine(unit, MAX + 1);
    const c = block(lang, one);
    expect(highlight).not.toHaveBeenCalled();
    expect(label(c)).toBe(`${name} · not highlighted (a ${MAX + 1}-character line)`);
    expect(c.querySelector('pre > code.hljs')?.textContent).toBe(one);
    cleanup();
    const big = lines(unit, MAX + 1, lang);
    expect(big.length).toBeGreaterThan(capOf(lang) - 2 * (MAX + 1));
    expect(label(block(lang, big))).toBe(`${name} · not highlighted (a ${MAX + 1}-character line)`);
    expect(highlight).not.toHaveBeenCalled();
  });

  it.each([
    ['markdown', '[', 'Markdown'],
    ['yaml', 'a a a ', 'YAML'],
  ])('a %s block of %j lines of exactly the bound is highlighted', (lang, unit, name) => {
    const highlight = spyHighlight();
    const c = block(lang, lines(unit, MAX, lang));
    expect(label(c)).toBe(name);
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('64 KiB of ordinary short lines is highlighted', () => {
    const highlight = spyHighlight();
    const one = 'const answer = compute(42); // the answer';
    const body = Array.from({ length: Math.floor(MD_HIGHLIGHT_BLOCK_MAX_CHARS / (one.length + 1)) }, () => one).join('\n');
    expect(body.length).toBeLessThanOrEqual(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    expect(label(block('python', body))).toBe('Python');
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('a line break of either kind ends a line: CRLF and lone CR lines of exactly the bound highlight', () => {
    const highlight = spyHighlight();
    const line = '['.repeat(MAX);
    expect(label(block('markdown', `${line}\r\n${line}\r\n${line}`))).toBe('Markdown');
    expect(label(block('yaml', `${line}\r${line}`))).toBe('YAML');
    expect(highlight).toHaveBeenCalledTimes(2);
  });

  it('one long line among short ones is found, and the label carries that line length', () => {
    const highlight = spyHighlight();
    const body = `# title\n${'a '.repeat(1100)}\nend`;
    expect(label(block('yaml', body))).toBe('YAML · not highlighted (a 2200-character line)');
    expect(highlight).not.toHaveBeenCalled();
  });

  it('chat gets the bound through the shared components, on the synchronous path and the worker path', async () => {
    const highlight = spyHighlight();
    const small = `\`\`\`markdown\n${'['.repeat(MAX + 1)}\n\`\`\`\n`;
    expect(utf8ByteLength(small)).toBeLessThanOrEqual(CHAT_SYNC_MAX_BYTES);
    expect(label((await chat(small)).container)).toBe(`Markdown · not highlighted (a ${MAX + 1}-character line)`);
    cleanup();
    const large = `\`\`\`markdown\n${['['.repeat(MAX + 1), '['.repeat(MAX + 1), '['.repeat(MAX + 1)].join('\n')}\n\`\`\`\n`;
    expect(utf8ByteLength(large)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const { container, parser } = await chat(large);
    expect(parser).toHaveBeenCalledTimes(1);
    expect(label(container)).toBe(`Markdown · not highlighted (a ${MAX + 1}-character line)`);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('a block that trips both bounds is labelled by its word: the word bound is checked first', () => {
    const highlight = spyHighlight();
    expect(label(block('ts', 'a'.repeat(5000)))).toBe('TypeScript · not highlighted (a 5000-character word)');
    expect(highlight).not.toHaveBeenCalled();
  });

  it('a block over the size cap keeps its size label whatever its lines', () => {
    const highlight = spyHighlight();
    expect(label(block('markdown', '['.repeat(70000)))).toBe('Markdown · not highlighted (69 KiB)');
    expect(highlight).not.toHaveBeenCalled();
  });

  it('a block over MD_HIGHLIGHT_BLOCK_MAX_CHARS is never scanned: the size check comes first', () => {
    // Both scans read the block through `charCodeAt` and nothing else on the block's path does, so the count of its
    // calls is the count of scanned units.
    spyHighlight();
    const calls = vi.spyOn(String.prototype, 'charCodeAt');
    block('ts', 'a'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 1));
    const over = calls.mock.calls.length;
    calls.mockClear();
    block('ts', 'a'.repeat(1000));
    const within = calls.mock.calls.length;
    calls.mockRestore();
    expect(over).toBeLessThan(1000);
    expect(within).toBeGreaterThanOrEqual(1000);
  });

  it('an unregistered fence and highlight={false} are never scanned either', () => {
    spyHighlight();
    const calls = vi.spyOn(String.prototype, 'charCodeAt');
    block('mermaid', 'a'.repeat(5000));
    render(<CodeBlock highlight={false}><code className="language-ts">{'a'.repeat(5000)}</code></CodeBlock>);
    const n = calls.mock.calls.length;
    calls.mockRestore();
    expect(n).toBeLessThan(1000);
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
    const chips = render(renderHast(treeOf(`Press \`${at}\` now.`, 'docs'), { components: SHARED_COMPONENTS })).container;
    expect(chips.querySelectorAll('kbd')).toHaveLength(31);
    cleanup();
    const plain = render(renderHast(treeOf(`Press \`${over}\` now.`, 'docs'), { components: SHARED_COMPONENTS })).container;
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
    const { container } = render(renderHast(tree, { components: SHARED_COMPONENTS }));
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

describe('T13 review 4-3: a block the page budget refuses labels itself by its size when it is over the cap', () => {
  const big = 'const a = 1;\n'.repeat(5400);
  const KIB = Math.ceil(big.replace(/\n$/, '').length / 1024);

  it('highlight={false} over the cap reads "{label} · not highlighted ({KiB} KiB)", with no scan and no colour', () => {
    expect(big.length).toBeGreaterThan(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    const spy = spyHighlight();
    const { container } = render(<CodeBlock highlight={false}><code className="language-ts">{big}</code></CodeBlock>);
    expect(label(container)).toBe(`TypeScript · not highlighted (${KIB} KiB)`);
    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.hljs-keyword')).toBeNull();
  });

  it('highlight={false} within the cap keeps its plain label, and an unregistered language over it keeps its own', () => {
    const small = render(<CodeBlock highlight={false}><code className="language-ts">{'const a = 1;'}</code></CodeBlock>);
    expect(label(small.container)).toBe('TypeScript');
    const other = render(<CodeBlock highlight={false}><code className="language-nosuchlang">{big}</code></CodeBlock>);
    expect(label(other.container)).toBe('nosuchlang');
  });

  it('a refused block is never scanned for a word or a line, however long either is', () => {
    const word = 'a'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS + 10);
    spyHighlight();
    const calls = vi.spyOn(String.prototype, 'charCodeAt');
    const { container } = render(<CodeBlock highlight={false}><code className="language-ts">{word}</code></CodeBlock>);
    const n = calls.mock.calls.length;
    calls.mockRestore();
    expect(label(container)).toBe(`TypeScript · not highlighted (${Math.ceil(word.length / 1024)} KiB)`);
    expect(n).toBeLessThan(1000);
  });
});

describe('Review 439 F1: a fence of whitespace that spans lines is not highlighted past MD_HIGHLIGHT_MAX_BLANK_CHARS', () => {
  const MAX = MD_HIGHLIGHT_MAX_BLANK_CHARS;
  /** `unit` repeated and cut to `n` characters. */
  const unitRun = (unit: string, n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  const SHAPES: ReadonlyArray<readonly [string, string]> = [
    ['\n', 'a newline'], [' \n', 'a space and a newline'], ['\t\n', 'a tab and a newline'], ['\r\n', 'a CRLF pair'],
  ];
  const NOT_HIGHLIGHTED = /^TypeScript \u00b7 not highlighted \(a (\d+)-character run of whitespace\)$/;
  /** The sentence of a block whose longest blank run is `n` characters. */
  const said = (n: number): string => `TypeScript \u00b7 not highlighted (a ${n}-character run of whitespace)`;

  it('declares 2048 characters', () => {
    expect(MD_HIGHLIGHT_MAX_BLANK_CHARS).toBe(2048);
  });

  it.each(SHAPES)('a ts block of %j one unit over the bound is not highlighted and says why (%s)', (unit) => {
    const highlight = spyHighlight();
    const one = unitRun(unit, MAX + 1);
    const c = block('ts', one);
    expect(highlight).not.toHaveBeenCalled();
    expect(label(c)).toBe(said(MAX + 1));
    expect(c.querySelector('pre > code.hljs')?.textContent).toBe(one);
    cleanup();
    // A `ts` block is capped at 8 192 characters (review 450 F1), so the largest that reaches the whitespace bound is that.
    const big = unitRun(unit, 8192);
    expect(label(block('ts', big))).toBe(said(8192));
    expect(highlight).not.toHaveBeenCalled();
  });

  it.each(SHAPES)('a ts block of %j exactly at the bound is highlighted (%s)', (unit) => {
    const highlight = spyHighlight();
    const c = block('ts', unitRun(unit, MAX));
    expect(label(c)).toBe('TypeScript');
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('the same shapes through Docs (parseMarkdown, renderHast, SHARED_COMPONENTS) never reach highlight.js', () => {
    const highlight = spyHighlight();
    for (const [unit] of SHAPES) {
      const src = `\`\`\`ts\n${unitRun(unit, 8000)}\n\`\`\`\n`;
      const { container } = render(renderHast(treeOf(src, 'docs'), { components: SHARED_COMPONENTS }));
      expect(label(container)).toMatch(NOT_HIGHLIGHTED);
      expect(Number(NOT_HIGHLIGHTED.exec(label(container) ?? '')?.[1])).toBeGreaterThan(MAX);
      cleanup();
    }
    expect(highlight).not.toHaveBeenCalled();
  });

  it("chat gets the bound on the synchronous path and on the worker path", async () => {
    const highlight = spyHighlight();
    for (const [unit] of SHAPES) {
      // A margin over the bound: the parse drops a fence's trailing blank lines.
      const small = `\`\`\`ts\nx${unitRun(unit, MAX + 64)}x\n\`\`\`\n`;
      expect(utf8ByteLength(small)).toBeLessThanOrEqual(CHAT_SYNC_MAX_BYTES);
      const sync = await chat(small);
      expect(sync.parser).not.toHaveBeenCalled();
      expect(label(sync.container)).toMatch(NOT_HIGHLIGHTED);
      cleanup();
      const large = `\`\`\`ts\nx${unitRun(unit, 3 * MAX)}x\n\`\`\`\n`;
      expect(utf8ByteLength(large)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
      const worker = await chat(large);
      expect(worker.parser).toHaveBeenCalledTimes(1);
      expect(worker.container.querySelector('pre.msg-plain')).toBeNull();
      expect(label(worker.container)).toMatch(NOT_HIGHLIGHTED);
      expect(Number(NOT_HIGHLIGHTED.exec(label(worker.container) ?? '')?.[1])).toBeGreaterThan(MAX);
      cleanup();
    }
    expect(highlight).not.toHaveBeenCalled();
  });

  it('every grammar the shared components register is bounded the same way, not only ts and js', () => {
    const highlight = spyHighlight();
    for (const lang of ['javascript', 'bash', 'python', 'markdown', 'yaml', 'json']) {
      const c = block(lang, unitRun('\n', MAX + 1));
      expect(label(c)).toMatch(/not highlighted \(a 2049-character run of whitespace\)$/);
      cleanup();
    }
    expect(highlight).not.toHaveBeenCalled();
  });

  it('runs that are each within the bound highlight: a non-blank unit ends a run', () => {
    const highlight = spyHighlight();
    const run = unitRun('\n', MAX);
    expect(label(block('ts', `${run};${run};${run}`))).toBe('TypeScript');
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('a mixed run of tabs, spaces, CR and LF counts as one run', () => {
    const highlight = spyHighlight();
    expect(label(block('ts', unitRun(' \t\r\n', MAX + 1)))).toBe(said(MAX + 1));
    expect(highlight).not.toHaveBeenCalled();
  });

  it.each(['\u3000\n', '\u00a0\n', '\ufeff\n', '\u2028\n', '\u2029\n'])('a run of %j (a blank unit from 0x7f up joins a run) is bounded', (unit) => {
    const highlight = spyHighlight();
    expect(label(block('ts', unitRun(unit, MAX + 1)))).toBe(said(MAX + 1));
    expect(highlight).not.toHaveBeenCalled();
  });

  it.each(['\u2028', '\u2029'])('a run of %j alone is refused by the word bound first (r10 counts every unit from 0x7f up)', (unit) => {
    const highlight = spyHighlight();
    expect(label(block('ts', unitRun(unit, MAX + 1)))).toBe(`TypeScript \u00b7 not highlighted (a ${MAX + 1}-character word)`);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('longestBlankRun counts exactly the units of ECMAScript whitespace, in one pass, and a neighbour ends a run', () => {
    const members = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2005, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff];
    for (const m of members) expect(longestBlankRun(String.fromCharCode(m).repeat(7))).toBe(7);
    const neighbours = [0x08, 0x0e, 0x1f, 0x21, 0x85, 0x180e, 0x1fff, 0x200b, 0x202e, 0x2060, 0x3001, 0xfefe, 0xfeff + 1];
    for (const n of neighbours) expect(longestBlankRun(String.fromCharCode(n).repeat(7))).toBe(0);
    expect(longestBlankRun('')).toBe(0);
    expect(longestBlankRun('a\n\n b\n  \t\r\n\n c')).toBe(8);
    expect(longestBlankRun('  \n\n\u2028 x\n')).toBe(6);
  });

  it('the label order is size, then word, then line, then whitespace', () => {
    const highlight = spyHighlight();
    expect(label(block('ts', `${unitRun('\n', MAX + 1)}${'a'.repeat(MD_HIGHLIGHT_BLOCK_MAX_CHARS)}`))).toBe(`TypeScript \u00b7 not highlighted (${Math.ceil((MAX + 1 + MD_HIGHLIGHT_BLOCK_MAX_CHARS) / 1024)} KiB)`);
    expect(label(block('ts', `${unitRun('\n', MAX + 1)}${'a'.repeat(300)}`))).toBe('TypeScript \u00b7 not highlighted (a 300-character word)');
    const spaces = ' '.repeat(MD_HIGHLIGHT_MAX_LINE_CHARS + 1);
    expect(label(block('ts', spaces))).toBe(`TypeScript \u00b7 not highlighted (a ${MD_HIGHLIGHT_MAX_LINE_CHARS + 1}-character line)`);
    expect(highlight).not.toHaveBeenCalled();
  });

  it('a block over the size cap is not scanned for a blank run, and an unregistered fence keeps its plain label', () => {
    const highlight = spyHighlight();
    expect(label(block('ts', unitRun('\n', MD_HIGHLIGHT_BLOCK_MAX_CHARS + 5)))).toBe(`TypeScript \u00b7 not highlighted (${Math.ceil((MD_HIGHLIGHT_BLOCK_MAX_CHARS + 5) / 1024)} KiB)`);
    expect(label(block('mermaid', unitRun('\n', MAX + 1)))).toBe('mermaid');
    expect(highlight).not.toHaveBeenCalled();
  });

  it('8 KiB of ordinary code with indentation and blank lines is highlighted, with markup', () => {
    const chunk = [
      'export function total(items: readonly Item[]): number {',
      '  let sum = 0;',
      '',
      '  for (const item of items) {',
      '    if (item.price > 0) {',
      '      sum += item.price * item.count;',
      '    }',
      '  }',
      '',
      '',
      '  return sum; // the total',
      '}',
      '',
    ].join('\n');
    const body = unitRun(chunk, 8192);
    expect(body.length).toBe(8192);
    const c = block('ts', body);
    expect(label(c)).toBe('TypeScript');
    expect(c.querySelectorAll('.hljs-keyword').length).toBeGreaterThan(0);
  });
});

describe('review 450 F1: typescript, javascript and rust have their own, smaller block caps', () => {
  // highlight.js 11.11.1 is quadratic in a block's size for `<a>` in `typescript`/`javascript` (JSX `hasClosingTag`) and
  // for a raw string `r#"` with no closer in `rust`, on shapes that pass the word, line and whitespace bounds. The
  // literals below are the decided values (8 192 and 4 096), never the imported constants, so a mutated constant reds.
  /** `unit` repeated, in lines of `n` characters (or one unit per line when `n` is 0), cut to `chars`. */
  const shape = (unit: string, n: number, chars: number): string => {
    const line = n === 0 ? unit : unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    return Array.from({ length: Math.ceil(chars / (line.length + 1)) + 1 }, () => line).join('\n').slice(0, chars);
  };
  const OVER_64 = /\u00b7 not highlighted \(64 KiB\)$/;
  const SHAPES: ReadonlyArray<readonly [string, number]> = [['<a>', 1800], ['<a>', 0], ['<ab>', 1800]];
  const JS_LANGS = ['ts', 'tsx', 'javascript'];

  it.each(JS_LANGS.flatMap((lang) => SHAPES.map(([unit, n]) => [lang, unit, n] as const)))(
    'a 64 KiB %s block of %j in lines of %d characters is not highlighted and says 64 KiB (Docs)',
    (lang, unit, n) => {
      const highlight = spyHighlight();
      const body = shape(unit, n, 65536);
      expect(body).toHaveLength(65536);
      const { container } = render(renderHast(treeOf(`\`\`\`${lang}\n${body}\n\`\`\`\n`, 'docs'), { components: SHARED_COMPONENTS }));
      expect(label(container)).toMatch(OVER_64);
      expect(highlight).not.toHaveBeenCalled();
    },
  );

  it.each(JS_LANGS)("the same %s shapes through chat's worker path are not highlighted either", async (lang) => {
    const highlight = spyHighlight();
    for (const [unit, n] of SHAPES) {
      const text = `\`\`\`${lang}\n${shape(unit, n, 65536)}\n\`\`\`\n`;
      expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
      const { container, parser } = await chat(text);
      expect(parser).toHaveBeenCalledTimes(1);
      expect(label(container)).toMatch(OVER_64);
      cleanup();
    }
    expect(highlight).not.toHaveBeenCalled();
  });

  it('a 64 KiB rust block of `r#"` lines is not highlighted and says 64 KiB, in Docs and on the worker path', async () => {
    const highlight = spyHighlight();
    const text = `\`\`\`rust\n${shape('r#"', 1800, 65536)}\n\`\`\`\n`;
    const docs = render(renderHast(treeOf(text, 'docs'), { components: SHARED_COMPONENTS }));
    expect(label(docs.container)).toMatch(OVER_64);
    cleanup();
    const worker = await chat(text);
    expect(worker.parser).toHaveBeenCalledTimes(1);
    expect(label(worker.container)).toMatch(OVER_64);
    cleanup();
    expect(label(block('rust', shape('r#"', 0, 65536)))).toMatch(OVER_64);
    expect(highlight).not.toHaveBeenCalled();
  });

  it.each([['ts'], ['tsx'], ['jsx'], ['javascript'], ['mjs'], ['cts']])(
    'a %s block of exactly 8 192 characters is highlighted; 8 193 is not, and says 9 KiB',
    (lang) => {
      const highlight = spyHighlight();
      expect(label(block(lang, shape('<a>', 1800, 8192)))).not.toMatch(/not highlighted/);
      expect(highlight).toHaveBeenCalledTimes(1);
      expect(label(block(lang, shape('<a>', 1800, 8193)))).toMatch(/\u00b7 not highlighted \(9 KiB\)$/);
      expect(highlight).toHaveBeenCalledTimes(1);
    },
  );

  it.each([['rust'], ['rs']])('a %s block of exactly 4 096 characters is highlighted; 4 097 is not, and says 5 KiB', (lang) => {
    const highlight = spyHighlight();
    expect(label(block(lang, shape('r#"', 1800, 4096)))).not.toMatch(/not highlighted/);
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(label(block(lang, shape('r#"', 1800, 4097)))).toMatch(/\u00b7 not highlighted \(5 KiB\)$/);
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('a highlighted-within-the-cap block through the worker path keeps its colour at exactly 8 192 characters', async () => {
    const highlight = spyHighlight();
    const text = `\`\`\`ts\n${shape('<a>', 1800, 8192)}\n\`\`\`\n`;
    const { container, parser } = await chat(text);
    expect(parser).toHaveBeenCalledTimes(1);
    expect(label(container)).toBe('TypeScript');
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('a real-sized TypeScript fence of about 7 KiB is highlighted, with markup', () => {
    const source = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'markdownGuard.ts'), 'utf8');
    const lines = source.split('\n');
    let real = '';
    for (const l of lines) {
      if ((real + l + '\n').length > 7000) break;
      real += `${l}\n`;
    }
    real = real.replace(/\n$/, '');
    expect(real.length).toBeGreaterThan(6000);
    expect(real.length).toBeLessThan(8192);
    const c = block('ts', real);
    expect(label(c)).toBe('TypeScript');
    expect(c.querySelectorAll('.hljs-keyword').length).toBeGreaterThan(0);
  });

  it('a grammar outside the set keeps the 64 KiB cap: 20 000 characters of python and of json are highlighted', () => {
    const highlight = spyHighlight();
    const py = 'x = 1\n'.repeat(3400).slice(0, 20000);
    expect(py).toHaveLength(20000);
    expect(label(block('python', py))).toBe('Python');
    expect(label(block('json', '1,\n'.repeat(7000).slice(0, 20000)))).toBe('JSON');
    expect(highlight).toHaveBeenCalledTimes(2);
  });
});

describe('review 450 F1, the closure: a grammar that embeds a bounded grammar through `subLanguage` is bounded too', () => {
  // `xml` is registered WITHOUT its script and style sub-languages (highlight.js's xml is quadratic on those regions
  // whatever they embed), so no registered grammar reaches typescript, javascript or rust today. Literals below are the
  // decided values, never the imported constants, so a mutated constant reds.
  const shape = (unit: string, n: number, chars: number): string => {
    const line = unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
    return Array.from({ length: Math.ceil(chars / (line.length + 1)) + 1 }, () => line).join('\n').slice(0, chars);
  };
  /** `'<script>\n'`, then `<a>` in lines of 1 800 characters, `chars` in all. */
  const scripted = (chars: number): string => `<script>\n${shape('<a>', 1800, chars - 9)}`;

  // The walk below shares nothing with the module: it follows EVERY object-valued property of a grammar's definition
  // (not just `contains`, `variants` and `starts`), whatever depth, and reads `subLanguage` as a string or an array.
  // An EMPTY array is highlight.js's auto-detect across every registered grammar, so it reaches them all.
  const BASE: Readonly<Record<string, number>> = { typescript: 8192, javascript: 8192, rust: 4096 };
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
  const closure = (): Map<string, number> => {
    const registered = hljs.listLanguages();
    const canonical = (name: string): string | undefined => {
      const def = hljs.getLanguage(name);
      return def === undefined ? undefined : registered.find((r) => hljs.getLanguage(r) === def);
    };
    const direct = new Map<string, Set<string>>();
    for (const g of registered) {
      const targets = new Set<string>();
      for (const sub of subLanguagesOf(hljs.getLanguage(g)!, registered)) {
        const c = canonical(sub);
        if (c !== undefined) targets.add(c);
      }
      direct.set(g, targets);
    }
    const out = new Map<string, number>();
    for (const g of registered) {
      const reach = new Set<string>([g]);
      for (const r of reach) for (const t of direct.get(r) ?? []) reach.add(t);
      const caps = [...reach].map((r) => BASE[r]).filter((c): c is number => c !== undefined);
      if (caps.length > 0) out.set(g, Math.min(...caps));
    }
    return out;
  };

  it('the module\'s bounded set is exactly the closure of the base set under the registered grammars\' subLanguage references', () => {
    // Highlight once first: highlight.js compiles a grammar's modes on first use, and the walk must read either shape.
    for (const g of hljs.listLanguages()) hljs.highlight('<script>a</script>', { language: g, ignoreIllegals: true });
    expect(Object.fromEntries(HIGHLIGHT_BOUNDED_CAPS)).toEqual(Object.fromEntries(closure()));
  });

  it('today that set is typescript and javascript at 8 192 and rust at 4 096; yaml\'s ruby and xml\'s handlebars are not registered', () => {
    expect(Object.fromEntries(HIGHLIGHT_BOUNDED_CAPS)).toEqual({ typescript: 8192, javascript: 8192, rust: 4096 });
    expect(hljs.getLanguage('ruby')).toBeUndefined();
    expect(hljs.getLanguage('handlebars')).toBeUndefined();
    expect([...subLanguagesOf(hljs.getLanguage('yaml')!, [])]).toContain('ruby');
  });

  it('every name of HIGHLIGHT_BOUNDED_CAPS and every alias highlight.js resolves to it takes its cap and the scan budget; every other grammar takes 65 536 and does not', () => {
    const bounded = new Set<string>();
    for (const [name, cap] of HIGHLIGHT_BOUNDED_CAPS) {
      const aliases = (hljs.getLanguage(name) as { aliases?: string[] }).aliases ?? [];
      for (const alias of [name, ...aliases, ...(name === 'typescript' ? ['tsx'] : [])]) {
        bounded.add(alias);
        expect(hljs.getLanguage(alias), alias).toBe(hljs.getLanguage(name));
        expect(highlightBlockCap(alias), alias).toBe(cap);
        expect(inScanPageBudget(alias), alias).toBe(true);
      }
    }
    expect(bounded.size).toBeGreaterThanOrEqual(3);
    const others = hljs.listLanguages().filter((n) => !HIGHLIGHT_BOUNDED_CAPS.has(n));
    expect(others.length).toBeGreaterThan(0);
    for (const name of others) {
      expect(highlightBlockCap(name), name).toBe(65536);
      expect(inScanPageBudget(name), name).toBe(false);
    }
  });

  it('inMarkdownPageBudget is true for markdown and every alias highlight.js resolves to it, and false for every other name', () => {
    const mdDef = hljs.getLanguage('markdown')!;
    const aliases = (mdDef as { aliases?: string[] }).aliases ?? [];
    expect(aliases).toEqual(expect.arrayContaining(['md']));
    for (const alias of ['markdown', ...aliases]) expect(inMarkdownPageBudget(alias), alias).toBe(true);
    for (const name of hljs.listLanguages().filter((n) => n !== 'markdown')) expect(inMarkdownPageBudget(name), name).toBe(false);
    expect(inMarkdownPageBudget('')).toBe(false);
    expect(inMarkdownPageBudget('nope')).toBe(false);
  });

  it('the registered xml carries no subLanguage on any mode (script and style contents are one plain run), and every alias of xml is that grammar', () => {
    const xmlDef = hljs.getLanguage('xml')!;
    expect([...subLanguagesOf(xmlDef, [])]).toEqual([]);
    // Compiled or not: highlight once, then read again.
    hljs.highlight('<script>a</script><style>a{}</style>', { language: 'xml', ignoreIllegals: true });
    expect([...subLanguagesOf(xmlDef, [])]).toEqual([]);
    const aliases = (xmlDef as { aliases?: string[] }).aliases ?? [];
    expect(aliases).toEqual(expect.arrayContaining(['html', 'svg']));
    for (const alias of [...aliases, 'html', 'svg']) expect(hljs.getLanguage(alias)).toBe(xmlDef);
  });

  describe('deriveBoundedCaps on synthetic grammars', () => {
    const synth = (grammars: Record<string, object>) => {
      const h = hljs.newInstance();
      for (const [name, def] of Object.entries(grammars)) h.registerLanguage(name, () => ({ name, contains: [], ...def }));
      return h;
    };
    // highlight.js lower-cases a name it looks up, so the synthetic names are lower case.
    const js = { contains: [] };
    const base = new Map([['js', 8192]]);
    const caps = (grammars: Record<string, object>, b: ReadonlyMap<string, number> = base) =>
      Object.fromEntries(deriveBoundedCaps(synth(grammars), b));

    it('an empty subLanguage array reaches every registered grammar, so it is bounded when any bounded grammar is registered', () => {
      expect(caps({ js, auto: { contains: [{ begin: 'a', subLanguage: [] }] }, plain: {} })).toEqual({ js: 8192, auto: 8192 });
      expect(caps({ auto: { contains: [{ begin: 'a', subLanguage: [] }] }, plain: {} }, new Map())).toEqual({});
    });

    it('a string chain of two steps (A to B to js) bounds A and B', () => {
      expect(caps({
        js, b: { contains: [{ begin: 'a', subLanguage: 'js' }] }, a: { contains: [{ begin: 'a', subLanguage: 'b' }] },
      })).toEqual({ js: 8192, b: 8192, a: 8192 });
    });

    it('a subLanguage reached only through `starts` counts, and so does one reached only through `variants`', () => {
      expect(caps({ js, viastarts: { contains: [{ begin: 'a', starts: { end: 'b', subLanguage: ['js'] } }] } }))
        .toEqual({ js: 8192, viastarts: 8192 });
      expect(caps({ js, viavariants: { contains: [{ variants: [{ begin: 'a' }, { begin: 'b', subLanguage: 'js' }] }] } }))
        .toEqual({ js: 8192, viavariants: 8192 });
    });

    it('an unregistered name reaches nothing', () => {
      expect(caps({ js, lost: { contains: [{ begin: 'a', subLanguage: 'nowhere' }] } })).toEqual({ js: 8192 });
    });

    it('the smallest cap among the grammars a chain reaches wins', () => {
      const b = new Map([['js', 8192], ['rs', 4096]]);
      expect(caps({
        js, rs: {}, both: { contains: [{ begin: 'a', subLanguage: ['js', 'rs'] }] },
        deep: { contains: [{ begin: 'a', subLanguage: 'both' }] },
      }, b)).toEqual({ js: 8192, rs: 4096, both: 4096, deep: 4096 });
    });
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
    ['markdown', 'md'].flatMap((lang) => shapes.flatMap(([name, make]) => [8192, 65536].map((n) => [lang, name, n, make] as const))),
  )('a %s block holding HTML, shape %s at %i characters, is highlighted', (lang, _name, n, make) => {
    const c = real(lang, make(n));
    expect(label(c)).not.toMatch(/not highlighted/);
    expect(c.querySelector('code')!.textContent).toBe(make(n));
  });

  it('a 64 KiB xml, html and markdown block of <script> then <a> lines IS highlighted; the body of the script is plain', () => {
    for (const lang of ['xml', 'html', 'svg', 'markdown']) {
      const body = scripted(65536);
      expect(body).toHaveLength(65536);
      const c = real(lang, body);
      expect(label(c)).not.toMatch(/not highlighted/);
      expect(c.querySelector('code')!.innerHTML).not.toMatch(HLJS_SPANS);
      cleanup();
    }
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

  it('a grammar that embeds nothing bounded keeps the 64 KiB cap: 20 000 characters of dockerfile (embeds bash) are highlighted', () => {
    const highlight = spyHighlight();
    expect(label(block('dockerfile', 'RUN echo a\n'.repeat(1800).slice(0, 20000)))).toBe('Dockerfile');
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('a ts block of 10 000 characters the page budget refuses is labelled by its own cap: 10 KiB', () => {
    const highlight = spyHighlight();
    const { container } = render(
      <CodeBlock highlight={false}>
        <code className="language-ts">{`${'const a = 1;\n'.repeat(800).slice(0, 10000)}\n`}</code>
      </CodeBlock>,
    );
    expect(label(container)).toBe('TypeScript \u00b7 not highlighted (10 KiB)');
    expect(highlight).not.toHaveBeenCalled();
  });
});
