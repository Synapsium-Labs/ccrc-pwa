// The parse pipeline (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and section 4.15's M4.P1's
// control, M4.P4 and M4.P12's W4 half). `parseMarkdown` pre-scans, runs react-markdown's own processor stage by
// stage, turns raw HTML into text, drops `position`, measures depth and elements, and never throws.
// W5 Task 4 adds the docs profile's real `<br>` (the 2026-10-12 spec's A16 and M9.1; the W5 plan's refinement (i)):
// W4's profile-equality case is amended to A16's form in place, and M9.1's cases are appended at the end.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Root as HastRoot } from 'hast';
import { describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SHARED_COMPONENTS } from '../src/lib/markdown';
import { parseMarkdown, parseWithoutPrescan, settleHast, type ParseOutcome } from '../src/lib/markdownParse';
import { renderHast } from '../src/lib/renderHast';
import { prescanMarkdown, utf8ByteLength } from '../src/lib/markdownGuard';
import { CHAT_CORPUS, RECAP_CASE } from './markdownCorpus';

interface AnyNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: AnyNode[];
}

/** Every node of `tree`, by an explicit-stack walk (a recursive walk could not visit a deep tree). */
function nodes(tree: unknown): AnyNode[] {
  const out: AnyNode[] = [];
  const stack = [tree as AnyNode];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    for (const c of n.children ?? []) stack.push(c);
  }
  return out;
}

const treeOf = (o: ParseOutcome): HastRoot => {
  if (o.kind !== 'tree') throw new Error(`expected a tree, got ${JSON.stringify(o)}`);
  return o.tree;
};

/** The three spellings the docs profile draws as a `br` element (the 2026-10-12 spec's A16), as a whole value. */
const BR_SPELLING = /^<br(?: ?\/)?>$/;

/** `docs` with every `br` element that stands where `chat` holds a text node spelling `<br>`, `<br/>` or `<br />`
 *  put back as that text node: the one difference A16 allows between the two profiles, undone. Every other node is
 *  copied as it is, so any other difference survives the copy and fails the deep-equal that follows. A hard line
 *  break's `br` is in both trees, so it is compared like any element. Explicit stack. */
function brAsChatText(docs: ParseOutcome, chat: ParseOutcome): ParseOutcome {
  if (docs.kind !== 'tree' || chat.kind !== 'tree') return docs;
  const tree = structuredClone(docs.tree);
  const stack: [AnyNode, AnyNode][] = [[tree as unknown as AnyNode, chat.tree as unknown as AnyNode]];
  while (stack.length > 0) {
    const [d, c] = stack.pop()!;
    const dk = d.children ?? [];
    const ck = c.children ?? [];
    for (let i = 0; i < dk.length; i += 1) {
      const dn = dk[i]!;
      const cn = ck[i];
      if (cn === undefined) continue;
      if (dn.type === 'element' && dn.tagName === 'br' && cn.type === 'text' && BR_SPELLING.test(cn.value ?? '')) {
        dk[i] = { type: 'text', value: cn.value };
      } else {
        stack.push([dn, cn]);
      }
    }
  }
  return { ...docs, tree };
}

/** Inputs holding a raw `<br>`, `<br/>` or `<br />` (A16): each differs between the two profiles, only by `br`. */
const BR_INPUTS: readonly string[] = [
  'a<br>b',
  'a<br/>b',
  'a<br />b',
  '<br>',
  'one<br>two<br/>three<br />four',
  '| a | b |\n|---|---|\n| x<br>y | z |',
  '> quoted<br>line',
  '- item<br>more',
];

describe('the outcome for ordinary Markdown', () => {
  it('a heading is a tree with no position, depth 2 (root > h1 > text)', () => {
    expect(parseMarkdown('# hi')).toEqual({
      kind: 'tree',
      depth: 2,
      tree: { type: 'root', children: [{ type: 'element', tagName: 'h1', properties: {}, children: [{ type: 'text', value: 'hi' }] }] },
    });
  });

  it('no node of any corpus tree keeps a position', () => {
    for (const c of [...CHAT_CORPUS, RECAP_CASE]) {
      for (const n of nodes(treeOf(parseMarkdown(c.text)))) expect(Object.hasOwn(n, 'position'), c.name).toBe(false);
    }
  });

  // Amended by W5 Task 4 to A16's form: equal, except on inputs that hold `<br>`, `<br/>` or `<br />`, which differ
  // only by `br` elements in the docs profile. The corpus holds none, so every corpus case is still strictly equal.
  it("A16: the 'chat' and 'docs' profiles give equal outcomes, except that a raw <br> is a br element in 'docs'; one argument means 'chat'", () => {
    const holdsBr = /<br(?: ?\/)?>/;
    const cases = [
      ...[...CHAT_CORPUS, RECAP_CASE].map((c) => ({ name: c.name, text: c.text })),
      ...BR_INPUTS.map((text) => ({ name: text, text })),
    ];
    for (const { name, text } of cases) {
      const chat = parseMarkdown(text, 'chat');
      const docs = parseMarkdown(text, 'docs');
      expect(parseMarkdown(text), name).toEqual(chat);
      expect(brAsChatText(docs, chat), name).toEqual(chat);
      if (!holdsBr.test(text)) expect(docs, name).toEqual(chat);
    }
    for (const text of BR_INPUTS) expect(parseMarkdown(text, 'docs'), text).not.toEqual(parseMarkdown(text, 'chat'));
  });
});

describe('M4.P1: the pre-scan stands in front of the parser', () => {
  const src = '>'.repeat(10000) + ' x';

  it('parseMarkdown refuses it', () => {
    expect(parseMarkdown(src)).toEqual({ kind: 'refused', why: 'container-depth', line: 1, value: 10000 });
  });

  // Control (measured at planning: the parser overflows at 3 000 levels and at 10 000 in vitest's worker): the
  // same input without the pre-scan throws inside the pipeline, which reports the error's name and nothing else.
  it('control: without the pre-scan the pipeline throws RangeError, reported by name only', () => {
    expect(parseWithoutPrescan(src)).toEqual({ kind: 'threw', error: 'RangeError' });
  });
});

/** `levels` nested emphasis spans, alternating `*` and `_`, each opened as `*a ` and closed as ` a*`: no run of one
 *  mark is longer than 1, and every level is a real `em` (root > p > em x levels > text). */
function nestedEmphasis(levels: number): string {
  let open = '';
  let close = '';
  for (let i = 0; i < levels; i += 1) {
    const mark = i % 2 === 0 ? '*' : '_';
    open += `${mark}a `;
    close = ` a${mark}${close}`;
  }
  return `${open}x${close}`;
}

describe('M4.P4: tree depth', () => {
  it('nested emphasis 100 deep passes the pre-scan and is too-deep with its depth', () => {
    const src = nestedEmphasis(100);
    expect(prescanMarkdown(src)).toEqual({ ok: true });
    expect(parseMarkdown(src)).toEqual({ kind: 'too-deep', depth: 102 });
  });

  it('a tree 64 deep is a tree and 65 is too-deep', () => {
    const at = parseMarkdown(nestedEmphasis(62));
    expect(at.kind).toBe('tree');
    expect(at).toMatchObject({ depth: 64 });
    expect(parseMarkdown(nestedEmphasis(63))).toEqual({ kind: 'too-deep', depth: 65 });
  });
});

const KIB = 1024;

describe('M4.P12: the element cap (W4 half)', () => {
  it('90 000 thematic breaks under 512 KiB are too-wide with the count', () => {
    const src = '---\n'.repeat(90000);
    expect(utf8ByteLength(src)).toBeLessThan(512 * KIB);
    expect(parseMarkdown(src)).toEqual({ kind: 'too-wide', elements: 90000 });
  }, 60000);

  it('22 000 autolinks under 512 KiB are too-wide with the count (22 000 links and their paragraph)', () => {
    const src = '<https://example.com>\n'.repeat(22000);
    expect(utf8ByteLength(src)).toBeLessThan(512 * KIB);
    expect(parseMarkdown(src)).toEqual({ kind: 'too-wide', elements: 22001 });
  }, 60000);

  it('20 000 elements are a tree and 20 001 are too-wide', () => {
    expect(parseMarkdown('---\n'.repeat(20000)).kind).toBe('tree');
    expect(parseMarkdown('---\n'.repeat(20001))).toEqual({ kind: 'too-wide', elements: 20001 });
  }, 60000);

  // The largest `.md` under docs/superpowers (a directory walk, by size then path), cut at its last newline before
  // 500 KiB. At planning: plans/2026-10-05-ccrc-history-w1-capture.md, a tree 8 deep with 3 947 elements.
  it('a real 500 KiB prose doc is a tree', () => {
    const docs = path.join(import.meta.dirname, '..', '..', 'docs', 'superpowers');
    const files: { file: string; size: number }[] = [];
    const dirs = [docs];
    while (dirs.length > 0) {
      const d = dirs.pop()!;
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) dirs.push(p);
        else if (e.isFile() && e.name.endsWith('.md')) files.push({ file: p, size: statSync(p).size });
      }
    }
    files.sort((a, b) => b.size - a.size || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
    const bytes = readFileSync(files[0]!.file);
    expect(bytes.length).toBeGreaterThan(500 * KIB);
    const src = new TextDecoder().decode(bytes.subarray(0, bytes.lastIndexOf(0x0a, 500 * KIB) + 1));
    expect(utf8ByteLength(src)).toBeGreaterThan(450 * KIB);
    expect(parseMarkdown(src, 'docs').kind).toBe('tree');
  }, 60000);
});

describe('raw HTML renders as literal text', () => {
  it('img, script and an angle-bracket placeholder become text nodes, and no raw node is left', () => {
    const src = '<img src=x onerror=alert(1)>\n\n<script>x</script>\n\nreach <server-host> on port 22';
    const all = nodes(treeOf(parseMarkdown(src)));
    expect(all.filter((n) => n.type === 'raw')).toEqual([]);
    expect(all.filter((n) => n.type === 'element').map((n) => n.tagName)).toEqual(['p']);
    const text = all.filter((n) => n.type === 'text').map((n) => n.value).join('');
    for (const raw of ['<img src=x onerror=alert(1)>', '<script>x</script>', '<server-host>']) {
      expect(text, raw).toContain(raw);
    }
  });
});

describe('the raw step and the measuring walk keep no recursion', () => {
  it('a hand-built hast 100 000 elements deep settles as too-deep, its innermost raw node turned to text', () => {
    const DEEP = 100000;
    const root = { type: 'root', children: [] as unknown[] };
    let parent: { children: unknown[] } = root;
    for (let i = 0; i < DEEP; i += 1) {
      const el = { type: 'element', tagName: 'div', properties: {}, children: [] as unknown[], position: { start: i } };
      parent.children.push(el);
      parent = el;
    }
    parent.children.push({ type: 'raw', value: '<b>deep</b>' });
    expect(settleHast(root as unknown as HastRoot)).toEqual({ kind: 'too-deep', depth: DEEP + 1 });
    expect(parent.children[0]).toEqual({ type: 'text', value: '<b>deep</b>' });
    expect(Object.hasOwn(parent, 'position')).toBe(false);
  });
});

describe("M9.1: the docs profile's real <br> (the 2026-10-12 spec's A16; the W5 plan's refinement (i))", () => {
  const BR = { type: 'element', tagName: 'br', properties: {}, children: [] };
  const P = (children: unknown[]) => ({ type: 'element', tagName: 'p', properties: {}, children });
  const brs = (o: ParseOutcome): AnyNode[] => nodes(treeOf(o)).filter((n) => n.type === 'element' && n.tagName === 'br');
  const textOf = (o: ParseOutcome): string =>
    nodes(treeOf(o)).filter((n) => n.type === 'text').map((n) => n.value).reverse().join('');

  it.each(['<br>', '<br/>', '<br />'])('a%sb is one br element between two text nodes in the docs profile', (tag) => {
    expect(parseMarkdown(`a${tag}b`, 'docs')).toEqual({
      kind: 'tree',
      depth: 2,
      tree: { type: 'root', children: [P([{ type: 'text', value: 'a' }, BR, { type: 'text', value: 'b' }])] },
    });
  });

  it.each(['<br>', '<br/>', '<br />'])('a%sb stays literal text in the chat profile', (tag) => {
    expect(parseMarkdown(`a${tag}b`, 'chat')).toEqual({
      kind: 'tree',
      depth: 2,
      tree: { type: 'root', children: [P([{ type: 'text', value: 'a' }, { type: 'text', value: tag }, { type: 'text', value: 'b' }])] },
    });
  });

  it('a line that is only <br> is one br element under the root in the docs profile, and text in chat', () => {
    expect(parseMarkdown('<br>', 'docs')).toEqual({ kind: 'tree', depth: 1, tree: { type: 'root', children: [BR] } });
    expect(parseMarkdown('<br>', 'chat')).toEqual({ kind: 'tree', depth: 1, tree: { type: 'root', children: [{ type: 'text', value: '<br>' }] } });
  });

  it.each([
    ['an attribute', 'a<br class=x>b'],
    ['an event handler', 'a<br onclick=x>b'],
    ['upper case', 'a<BR>b'],
    ['two spaces before the slash', 'a<br  />b'],
    ['a closing tag', 'a</br>b'],
    ['a block-level raw node holding more than the tag', '<br>\nhello'],
    ['a script element', '<script>x</script>'],
  ])('%s stays literal text in the docs profile', (_why, src) => {
    const o = parseMarkdown(src, 'docs');
    expect(brs(o)).toEqual([]);
    expect(nodes(treeOf(o)).filter((n) => n.type === 'raw')).toEqual([]);
    expect(textOf(o)).toBe(src);
    expect(o).toEqual(parseMarkdown(src, 'chat'));
  });

  // A text node that spells `<br>` is text, not a raw node: only `rawToText` may turn a raw node into a `br`.
  it.each([
    ['an escaped angle bracket', '\\<br>', '<br>'],
    ['an escaped angle bracket in a line', 'a\\<br>b', 'a<br>b'],
    ['character references', '&lt;br&gt;', '<br>'],
    ['character references in a line', 'a&lt;br&gt;b', 'a<br>b'],
    ['inline code', '`<br>`', '<br>'],
    ['inline code in a line', 'a `<br>` b', 'a <br> b'],
  ])('%s stays text in the docs profile, with no br element', (_why, src, text) => {
    const o = parseMarkdown(src, 'docs');
    expect(brs(o)).toEqual([]);
    expect(textOf(o)).toBe(text);
    expect(o).toEqual(parseMarkdown(src, 'chat'));
  });

  it('the br elements count toward DOCS_MAX_RENDER_ELEMENTS before anything renders', () => {
    const src = 'a<br>'.repeat(20000);
    expect(parseMarkdown(src, 'docs')).toEqual({ kind: 'too-wide', elements: 20001 });
    expect(parseMarkdown(src, 'chat').kind).toBe('tree');
  }, 60000);

  it('the docs br renders through renderHast as a real <br>; chat renders the tag as text', () => {
    const docs = render(renderHast(treeOf(parseMarkdown('a<br>b', 'docs')), { components: SHARED_COMPONENTS }));
    expect(docs.container.innerHTML).toBe('<p>a<br>b</p>');
    cleanup();
    const chat = render(renderHast(treeOf(parseMarkdown('a<br>b', 'chat')), { components: SHARED_COMPONENTS }));
    expect(chat.container.innerHTML).toBe('<p>a&lt;br&gt;b</p>');
    cleanup();
  });

  it("settleHast with one argument keeps 'chat'; with 'docs' a hand-built raw <br/> becomes a br element", () => {
    const tree = (): HastRoot => ({ type: 'root', children: [{ type: 'raw', value: '<br/>' }] }) as unknown as HastRoot;
    expect(settleHast(tree())).toEqual({ kind: 'tree', depth: 1, tree: { type: 'root', children: [{ type: 'text', value: '<br/>' }] } });
    expect(settleHast(tree(), 'chat')).toEqual(settleHast(tree()));
    expect(settleHast(tree(), 'docs')).toEqual({ kind: 'tree', depth: 1, tree: { type: 'root', children: [BR] } });
  });
});

describe('T13 review 1-2: DOCS_BR matches a whole value of the tag, so whitespace around it leaves literal text', () => {
  const brsOf = (o: ParseOutcome): AnyNode[] => nodes(treeOf(o)).filter((n) => n.type === 'element' && n.tagName === 'br');

  it.each([
    ['whitespace on both sides, a paragraph after', '  <br>  \n\nx'],
    ['leading whitespace only', '  <br>'],
    ['trailing whitespace, a paragraph after', '<br>  \n\nx'],
  ])('%s stays literal text in the docs profile, with no br element', (_why, src) => {
    const o = parseMarkdown(src, 'docs');
    expect(brsOf(o)).toEqual([]);
    expect(nodes(treeOf(o)).filter((n) => n.type === 'raw')).toEqual([]);
    expect(o).toEqual(parseMarkdown(src, 'chat'));
  });
});
