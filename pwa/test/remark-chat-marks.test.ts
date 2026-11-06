// The chat marks plugin (chat reading at a desk, Task M, D-8060; spec 2026-11-06 sections 3.1, 3.3 and 4.2): over chat's
// own plugin order (GFM, the alert callouts, then this), what it marks in the mdast and what it leaves alone. The
// recogniser's own rows are `chat-marks.test.ts`; that the two plugin lists carry it is `markdown-parse.test.ts` and
// `render-hast.test.tsx`.
import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { remarkAlerts } from '../src/lib/remarkAlerts';
import { remarkChatMarks } from '../src/lib/remarkChatMarks';
import { MARK_ATTR } from '../src/lib/chatMarks';

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkAlerts).use(remarkChatMarks);
const mdast = (src: string): MdNode => processor.runSync(processor.parse(src)) as unknown as MdNode;
const hast = (src: string): MdNode => {
  const p = unified().use(remarkParse).use(remarkGfm).use(remarkAlerts).use(remarkChatMarks).use(remarkRehype);
  return p.runSync(p.parse(src)) as unknown as MdNode;
};

/** Every node of `tree`, by an explicit stack, in document order. */
function all(tree: MdNode): MdNode[] {
  const out: MdNode[] = [];
  const stack: MdNode[] = [tree];
  while (stack.length > 0) {
    const n = stack.pop()!;
    out.push(n);
    const c = n.children ?? [];
    for (let i = c.length - 1; i >= 0; i -= 1) stack.push(c[i]!);
  }
  return out;
}
const props = (n: MdNode): Record<string, unknown> => n.data?.hProperties ?? {};
const marks = (tree: MdNode): MdNode[] => all(tree).filter((n) => MARK_ATTR.kind in props(n));
const withAttr = (tree: MdNode, attr: string): MdNode[] => all(tree).filter((n) => attr in props(n));

describe('where the plugin never looks', () => {
  it('no mark inside inline code, a fence, a link, an autolink or an image', () => {
    const src = [
      'Plain run 1500 is the control.',
      '',
      '`run 1501` and `#652`',
      '',
      '```',
      'run 1502 #653 4c677d328',
      '```',
      '',
      '[run 1503](https://example.com/a) and https://example.com/x/#654 and <https://example.com/item/7#655>',
      '',
      '![run 1504](https://example.com/x.png) and [run 1505][ref] and ![run 1506][ref]',
      '',
      '[ref]: https://example.com/r "run 1507"',
      '',
    ].join('\n');
    const found = marks(mdast(src)).map((n) => n.value);
    expect(found).toEqual(['run 1500']);
  });
});

describe('what a mark is', () => {
  it('a mark node carries kind and id and no URL', () => {
    const tree = hast('See run 1527 and #651.');
    const spans = all(tree).filter((n) => (n as { tagName?: string }).tagName === 'span');
    const shapes = spans.map((n) => (n as unknown as { properties: Record<string, unknown> }).properties);
    expect(shapes).toEqual([
      { [MARK_ATTR.kind]: 'run', [MARK_ATTR.id]: '1527' },
      { [MARK_ATTR.kind]: 'pr', [MARK_ATTR.id]: '651' },
    ]);
    expect(all(tree).some((n) => (n as { tagName?: string }).tagName === 'a')).toBe(false);
  });

  it('the text around a mark stays as text, in order', () => {
    const para = mdast('See run 1527 now.').children![0]!;
    expect(para.children!.map((n) => [n.value, n.data?.hName ?? null])).toEqual([
      ['See ', null], ['run 1527', 'span'], [' now.', null],
    ]);
  });
});

describe('status labels', () => {
  it('S2 marks a bold status word, and not a bold sentence holding one', () => {
    const tree = mdast('It is **blocked** now. It is **merged in by hand** too.');
    const strongs = all(tree).filter((n) => n.type === 'strong');
    expect(strongs.map((n) => props(n)[MARK_ATTR.status] ?? null)).toEqual(['wait', null]);
  });

  it('S1 splits a table cell\'s first status word', () => {
    const tree = mdast('| state | note |\n|---|---|\n| Failed, exit 1 | Failure is not a word |\n');
    const cells = all(tree).filter((n) => n.type === 'tableCell');
    expect(cells[2]!.children!.map((n) => [n.value, props(n)[MARK_ATTR.status] ?? null])).toEqual([
      ['Failed', 'fail'], [', exit 1', null],
    ]);
    expect(cells[3]!.children!.map((n) => [n.value, props(n)[MARK_ATTR.status] ?? null])).toEqual([
      ['Failure is not a word', null],
    ]);
  });

  it('S3 labels a status word after a name or a subject, and not an ordinary use of the word', () => {
    const tree = mdast('#651 merged, CI green, the value passed and a red herring.');
    expect(withAttr(tree, MARK_ATTR.status).map((n) => [n.value, props(n)[MARK_ATTR.status]])).toEqual([
      ['merged', 'merged'], ['green', 'ok'],
    ]);
  });
});

describe('lead-ins', () => {
  it('a root-level bold lead-in is marked with its kind', () => {
    const tree = mdast([
      '**What to do (either one):** pick one.',
      '',
      "**Why I can't do it.** It is held.",
      '',
      '- **Your call.** Either is fine.',
      '- **Actions:** listed below.',
      '',
      '**Note** this is only bold.',
      '',
      'Not **What to do:** at the start.',
      '',
    ].join('\n'));
    const strongs = all(tree).filter((n) => n.type === 'strong');
    expect(strongs.map((n) => props(n)[MARK_ATTR.lead] ?? null)).toEqual(['action', 'info', 'action', 'info', null, null]);
  });

  it('a lead-in inside a callout or a quote is not marked', () => {
    const tree = mdast([
      '> [!NOTE]',
      '> **What to do:** nothing.',
      '',
      '> **Your call.** In a plain quote.',
      '',
      '- a list item',
      '',
      '  > **Decision needed:** in a quote in a list.',
      '',
    ].join('\n'));
    expect(withAttr(tree, MARK_ATTR.lead)).toEqual([]);
  });

  it('the list after an action lead-in is marked, the list after an info lead-in is not, and a list two blocks later is not', () => {
    const tree = mdast([
      '**What to do:**',
      '',
      '1. first',
      '2. second',
      '',
      '**What happens next.**',
      '',
      '- a',
      '',
      '**To do:**',
      '',
      'A paragraph between.',
      '',
      '- b',
      '',
    ].join('\n'));
    const lists = tree.children!.filter((n) => n.type === 'list');
    expect(lists.map((n) => props(n)[MARK_ATTR.afterLead] ?? null)).toEqual(['action', null, null]);
  });
});

describe('the walk keeps no recursion', () => {
  it('a 100 000-deep tree does not overflow the stack', () => {
    const DEEP = 100_000;
    const tree: MdNode = { type: 'root', children: [] };
    let parent = tree;
    for (let i = 0; i < DEEP; i += 1) {
      const q: MdNode = { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: `run ${i}` }] }] };
      parent.children!.push(q);
      parent = q;
    }
    expect(() => remarkChatMarks()(tree)).not.toThrow();
    expect(marks(tree)).toHaveLength(DEEP);
  });
});
