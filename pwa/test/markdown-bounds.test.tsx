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
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import hljs from 'highlight.js/lib/core';
import type { Root as HastRoot } from 'hast';
import { ChatMarkdown, CodeBlock, SHARED_COMPONENTS, longestWordRun } from '../src/lib/markdown';
import { keystrokeParts, utf8ByteLength } from '../src/lib/markdownGuard';
import {
  CHAT_SYNC_MAX_BYTES, DOCS_MAX_RENDER_ELEMENTS, MD_HIGHLIGHT_BLOCK_MAX_CHARS, MD_HIGHLIGHT_MAX_LINE_CHARS,
  MD_HIGHLIGHT_MAX_WORD_CHARS, MD_KEYSTROKE_MAX_CHARS,
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

  it('a 32 KiB one-identifier ts fence through SHARED_COMPONENTS never reaches highlight.js', () => {
    const highlight = spyHighlight();
    const { container } = render(renderHast(treeOf(`\`\`\`ts\n${'a'.repeat(32768)}\n\`\`\`\n`, 'docs'), { components: SHARED_COMPONENTS }));
    expect(highlight).not.toHaveBeenCalled();
    expect(label(container)).toBe('TypeScript · not highlighted (a 32768-character word)');
  });

  it("the same fence through chat's worker path (ChatMarkdown, injected parser) never reaches highlight.js", async () => {
    const highlight = spyHighlight();
    const text = `\`\`\`ts\n${'a'.repeat(32768)}\n\`\`\`\n`;
    expect(utf8ByteLength(text)).toBeGreaterThan(CHAT_SYNC_MAX_BYTES);
    const { container, parser } = await chat(text);
    expect(parser).toHaveBeenCalledTimes(1);
    expect(container.querySelector('pre.msg-plain')).toBeNull();
    expect(highlight).not.toHaveBeenCalled();
    expect(label(container)).toBe('TypeScript · not highlighted (a 32768-character word)');
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

describe('W5 bound r10 (line): no highlighting for a block holding a line longer than MD_HIGHLIGHT_MAX_LINE_CHARS', () => {
  const MAX = MD_HIGHLIGHT_MAX_LINE_CHARS;
  /** `unit` repeated and cut to `n` characters. */
  const unitLine = (unit: string, n: number): string => unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
  /** 64 KiB (less the last partial line) of lines of `n` characters. */
  const lines = (unit: string, n: number): string =>
    Array.from({ length: Math.floor(MD_HIGHLIGHT_BLOCK_MAX_CHARS / (n + 1)) }, () => unitLine(unit, n)).join('\n');

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
    const big = lines(unit, MAX + 1);
    expect(big.length).toBeGreaterThan(MD_HIGHLIGHT_BLOCK_MAX_CHARS - 2 * (MAX + 1));
    expect(label(block(lang, big))).toBe(`${name} · not highlighted (a ${MAX + 1}-character line)`);
    expect(highlight).not.toHaveBeenCalled();
  });

  it.each([
    ['markdown', '[', 'Markdown'],
    ['yaml', 'a a a ', 'YAML'],
  ])('a %s block of %j lines of exactly the bound is highlighted', (lang, unit, name) => {
    const highlight = spyHighlight();
    const c = block(lang, lines(unit, MAX));
    expect(label(c)).toBe(name);
    expect(highlight).toHaveBeenCalledTimes(1);
  });

  it('64 KiB of ordinary short lines is highlighted', () => {
    const highlight = spyHighlight();
    const one = 'const answer = compute(42); // the answer';
    const body = Array.from({ length: Math.floor(MD_HIGHLIGHT_BLOCK_MAX_CHARS / (one.length + 1)) }, () => one).join('\n');
    expect(body.length).toBeLessThanOrEqual(MD_HIGHLIGHT_BLOCK_MAX_CHARS);
    expect(label(block('ts', body))).toBe('TypeScript');
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
