// The render tree (X2 P6.1 Step 0b2; X2 spec section 4.3, "Markdown in parts"). Ring L1, worker side: the rendered html of the
// shared Markdown library, parsed into a hast tree, and the source blocks its `data-line="a-b"` marks name. It is imported
// statically by `readerRenderJob.ts` (the worker's lazy chunk) and by nothing on the main thread, and it is the ONLY module that
// imports `hast-util-from-html`: the main bundle sees only the `MdBlock` TYPE, so it never loads the parser or the library.
//
// `renderedBlocks` reads the marks and answers each top-level block of the source in 0-based lines, `[from, to)` (the marks are
// 1-based and inclusive). The library marks a block element (a paragraph, a heading, a list and each of its items, a quote, a
// table, a rule, a fence's wrapper, a bare `pre` for indented code), and some elements it draws carry none: the `<details>` and
// `<summary>` lines, the comment anchor, the table's wrapper, the footnote rule and its section. So a block is the OUTERMOST
// element that carries a mark, at any depth: an element with one is recorded and its subtree is not searched for more, and an
// element without one is looked into. A malformed or missing mark is ignored (the element is then looked into). A footnote
// definition's own blocks are taken as one (the renderer draws them at the end of the page, but their lines are where the
// definition is written, and a part cut between two of them would turn an indented paragraph or fence of the definition into
// code).
//
// The kinds: `h1` and `h2` are `heading` (a part may start at one), `ul` and `ol` are `list`, `blockquote` is `quote`, a fence's
// wrapper (`div.codehilite`, `figure.mermaid-figure`) is `fence`, a bare `pre` is `code`, anything else `other`. A `list`'s
// `items` are its direct `li` elements (each an `other` block whose own `items` are its outermost marked descendants), a
// `quote`'s `items` are its outermost marked descendants, and an item's own items carry no items: one level only. Then the
// blocks are sorted by `from`, and any two that overlap (`b.from < a.to`) merge into one `other` block with no items.
import { fromHtml } from 'hast-util-from-html';
import type { Element, ElementContent, Root, RootContent } from 'hast';

export type MdBlockKind = 'heading' | 'list' | 'quote' | 'fence' | 'code' | 'other';

/** One block of the rendered source, in 0-based source lines, [from, to). `items`: a list's direct items, or a quote's (or an
 *  item's) own outermost blocks. */
export interface MdBlock { readonly from: number; readonly to: number; readonly kind: MdBlockKind; readonly items?: readonly MdBlock[] }

/** The rendered html as a hast tree (a fragment: no `html`, `head` or `body`). */
export function parseRendered(html: string): Root {
  return fromHtml(html, { fragment: true });
}

const MARK_RE = /^(\d+)-(\d+)$/;

/** The 0-based `[from, to)` lines an element's mark names, or null for a missing or malformed mark (a first line below 1, a
 *  last line before the first, a number past the safe integers). */
function marked(el: Element): { from: number; to: number } | null {
  const v = el.properties?.dataLine;
  if (typeof v !== 'string') return null;
  const m = MARK_RE.exec(v);
  if (m === null) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a < 1 || b < a) return null;
  return { from: a - 1, to: b };
}

function hasClass(el: Element, name: string): boolean {
  const c = el.properties?.className;
  return Array.isArray(c) && c.includes(name);
}

function kindOf(el: Element): MdBlockKind {
  switch (el.tagName) {
    case 'h1':
    case 'h2': return 'heading';
    case 'ul':
    case 'ol': return 'list';
    case 'blockquote': return 'quote';
    case 'pre': return 'code';
    case 'div': return hasClass(el, 'codehilite') ? 'fence' : 'other';
    case 'figure': return hasClass(el, 'mermaid-figure') ? 'fence' : 'other';
    default: return 'other';
  }
}

type Node = RootContent | ElementContent;

/** The outermost marked elements under `children`, in tree order, pushed to `out`: with their items when `rich` (the top level),
 *  as blocks with none otherwise. A footnote item's own blocks are one block. */
function outermost(children: readonly Node[], out: MdBlock[], rich: boolean): void {
  for (const n of children) {
    if (n.type !== 'element') continue;
    const at = marked(n);
    if (at !== null) { out.push(rich ? blockOf(n, at) : { ...at, kind: kindOf(n) }); continue; }
    if (n.tagName === 'li' && hasClass(n, 'footnote-item')) {
      const inner: MdBlock[] = [];
      outermost(n.children, inner, false);
      if (inner.length > 0) out.push({ from: Math.min(...inner.map((b) => b.from)), to: Math.max(...inner.map((b) => b.to)), kind: 'other' });
      continue;
    }
    outermost(n.children, out, rich);
  }
}

/** The block of a marked element: with its items for a list and a quote. */
function blockOf(el: Element, at: { from: number; to: number }): MdBlock {
  const kind = kindOf(el);
  if (kind === 'list') {
    const items: MdBlock[] = [];
    for (const c of el.children) {
      if (c.type !== 'element' || c.tagName !== 'li') continue;
      const li = marked(c);
      if (li === null) continue;
      const own: MdBlock[] = [];
      outermost(c.children, own, false);
      items.push({ ...li, kind: 'other', ...(own.length > 0 ? { items: own } : {}) });
    }
    return { ...at, kind, items };
  }
  if (kind === 'quote') {
    const items: MdBlock[] = [];
    outermost(el.children, items, false);
    return { ...at, kind, ...(items.length > 0 ? { items } : {}) };
  }
  return { ...at, kind };
}

/** The top-level blocks of a rendered tree, in source order (see the header). */
export function renderedBlocks(root: Root): MdBlock[] {
  const found: MdBlock[] = [];
  outermost(root.children, found, true);
  found.sort((a, b) => a.from - b.from || a.to - b.to);
  const merged: MdBlock[] = [];
  for (const b of found) {
    const last = merged[merged.length - 1];
    if (last !== undefined && b.from < last.to) merged[merged.length - 1] = { from: last.from, to: Math.max(last.to, b.to), kind: 'other' };
    else merged.push(b);
  }
  return merged;
}
