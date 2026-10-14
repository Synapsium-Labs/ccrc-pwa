// The parse pipeline (native Docs reader, W4 Task 3; design 2026-10-01 section 4.10 and section 4.15's M4.P1's
// control, M4.P4 and M4.P12's W4 half). `parseMarkdown` pre-scans, runs react-markdown's own processor stage by
// stage, turns raw HTML into text, drops `position`, measures depth and elements, and never throws.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Root as HastRoot } from 'hast';
import { describe, expect, it } from 'vitest';
import { parseMarkdown, parseWithoutPrescan, settleHast, type ParseOutcome } from '../src/lib/markdownParse';
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

  it("the 'chat' and 'docs' profiles give equal outcomes over the corpus; one argument means 'chat'", () => {
    for (const c of [...CHAT_CORPUS, RECAP_CASE]) {
      const chat = parseMarkdown(c.text, 'chat');
      expect(parseMarkdown(c.text, 'docs'), c.name).toEqual(chat);
      expect(parseMarkdown(c.text), c.name).toEqual(chat);
    }
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
