// The render tree (X2 P6.1 Step 0b2): the rendered html, parsed in the worker, and the source blocks its `data-line` marks name.
// `renderedBlocks` is the one reader of those marks, so the Markdown parts cut where the library's own parse cuts. The cases
// render with the library itself (highlight off, as the job does) and read the answer in 0-based source lines, [from, to).
import { render } from '@synapsium-labs/pinax-lib/render';
import { describe, expect, it } from 'vitest';
import { parseRendered, renderedBlocks, type MdBlock } from '../src/lib/renderTree';

const blocksOf = (md: string): readonly MdBlock[] => {
  const r = render(md, { highlight: false });
  if (r.outcome !== 'rendered') throw new Error(`fixture: ${r.outcome}`);
  return renderedBlocks(parseRendered(r.html));
};

/** A block as the cases write it: from, to, kind, and the same of its items. */
const flat = (b: MdBlock): unknown[] => [b.from, b.to, b.kind, ...(b.items === undefined ? [] : [b.items.map(flat)])];

/** The probe document: every shape that has a mark, and the ones that have none. Line numbers (1-based) in the comments. */
const PROBE = [
  '---', 'title: T', '---', // 1-3 front matter
  '# Heading one', // 4
  '', // 5
  'para line one', // 6
  'lazy line', // 7
  '', // 8
  '- item a', // 9
  '  ```ts', // 10
  '  code', // 11
  '  ```', // 12
  '- item b', // 13
  '', // 14
  '```js', // 15
  'x', // 16
  '```', // 17
  '', // 18
  '> quote', // 19
  '> ```', // 20
  '> q code', // 21
  '> ```', // 22
  '', // 23
  '<details>', // 24
  '<summary>Sum</summary>', // 25
  '', // 26
  'inside details', // 27
  '', // 28
  '</details>', // 29
  '', // 30
  'Foot[^1] ref', // 31
  '', // 32
  '[^1]: The note', // 33
  '', // 34
  '<!-- id:anchor -->', // 35
  '', // 36
  '| a | b |', // 37
  '|---|---|', // 38
  '| 1 | 2 |', // 39
  '', // 40
  '    indented code', // 41
  '', // 42
  '- [ ] task', // 43
  '- [x] done', // 44
  '', // 45
  'Setext', // 46
  '------', // 47
  '', // 48
  '***', // 49
  '', // 50
  '> [!NOTE]', // 51
  '> alert text', // 52
  '', // 53
  '```mermaid', // 54
  'flowchart LR', // 55
  '  A-->B', // 56
  '```', // 57
  '',
].join('\n');

describe('render tree', () => {
  it('render tree: the outermost data-line elements are the blocks, in source lines', () => {
    const got = blocksOf(PROBE).map((b) => [b.from, b.to, b.kind]);
    expect(got).toEqual([
      [0, 3, 'other'], //   front matter: the meta list
      [3, 4, 'heading'], // # Heading one
      [5, 7, 'other'], //   a paragraph and its lazy line
      [8, 14, 'list'], //   the list, whose item holds a fence
      [14, 17, 'fence'], // a fence
      [18, 22, 'quote'], // the quote, whose last block is a fence
      [26, 27, 'other'], // the paragraph inside the details lines (the `<details>` and `<summary>` lines carry no mark)
      [30, 31, 'other'], // the paragraph with the footnote reference
      [32, 33, 'other'], // the footnote definition's paragraph, which the renderer puts at the end of the page
      [36, 39, 'other'], // the table (its wrapper and the comment anchor carry no mark)
      [40, 41, 'code'], //  indented code: a bare `pre`
      [42, 45, 'list'], //  the task list
      [45, 47, 'heading'], // the setext heading
      [48, 49, 'other'], // the thematic break
      [50, 52, 'other'], // the alert
      [53, 57, 'fence'], // the Mermaid fence
    ]);
    // Sorted and apart.
    const all = blocksOf(PROBE);
    for (let i = 1; i < all.length; i += 1) expect(all[i]!.from).toBeGreaterThanOrEqual(all[i - 1]!.to);
  });

  it('render tree: a heading of level three or more is an other block, only h1 and h2 are heading', () => {
    expect(blocksOf('### three\n\n#### four\n\n# one\n').map((b) => [b.from, b.to, b.kind])).toEqual([
      [0, 1, 'other'], [2, 3, 'other'], [4, 5, 'heading'],
    ]);
  });

  it('render tree: a list\'s items and a quote\'s blocks are its items', () => {
    const md = [
      '- one', // 1
      '- two', // 2
      '  ```sh', // 3
      '  run', // 4
      '  ```', // 5
      '  tail', // 6
      '- three', // 7
      '', // 8
      '> lead', // 9
      '>', // 10
      '> ```', // 11
      '> q', // 12
      '> ```', // 13
      '>', // 14
      '> - nested', // 15
      '', // 16
      '1. a', // 17
      '2. b', // 18
    ].join('\n') + '\n';
    expect(blocksOf(md).map(flat)).toEqual([
      // The list takes the blank line after its last item; `tail` is the item's own text, not a block.
      [0, 8, 'list', [
        [0, 1, 'other'],
        [1, 6, 'other', [[2, 5, 'fence']]],
        [6, 8, 'other'],
      ]],
      [8, 15, 'quote', [[8, 9, 'other'], [10, 13, 'fence'], [14, 15, 'list']]],
      [16, 18, 'list', [[16, 17, 'other'], [17, 18, 'other']]],
    ]);
  });

  it('render tree: a footnote\'s own blocks are one block, so a part never ends inside a footnote', () => {
    const md = 'See[^n].\n\n[^n]: first para\n\n    second para\n\n    ```js\n    code\n    ```\n\nafter\n';
    const got = blocksOf(md).map((b) => [b.from, b.to, b.kind]);
    expect(got).toEqual([[0, 1, 'other'], [2, 9, 'other'], [10, 11, 'other']]);
  });

  it('render tree: overlapping blocks merge into one', () => {
    const root = parseRendered('<p data-line="1-3">a</p><p data-line="3-4">b</p><h2 data-line="9-9">c</h2><p data-line="2-2">d</p>');
    // 1-3 and 3-4 share line 3, and 2-2 lies inside 1-3 (the tree order is not the source order): one merged block, no items.
    expect(renderedBlocks(root).map(flat)).toEqual([[0, 4, 'other'], [8, 9, 'heading']]);
    // A list whose block overlaps a fence is merged too, and takes `other`.
    const merged = parseRendered('<ul data-line="1-5"><li data-line="1-5">x</li></ul><div class="codehilite" data-line="4-6"></div>');
    expect(renderedBlocks(merged).map(flat)).toEqual([[0, 6, 'other']]);
  });

  it('render tree: a malformed or missing data-line is ignored, and an element with one is not searched for more', () => {
    const root = parseRendered([
      '<p data-line="x">a</p><p data-line="3-">b</p><p data-line="0-2">c</p><p data-line="5-4">d</p><p>e</p>',
      '<div data-line="7-9"><p data-line="8-8">inner</p></div><section><p data-line="12-12">deep</p></section>',
    ].join(''));
    expect(renderedBlocks(root).map((b) => [b.from, b.to, b.kind])).toEqual([[6, 9, 'other'], [11, 12, 'other']]);
  });
});
