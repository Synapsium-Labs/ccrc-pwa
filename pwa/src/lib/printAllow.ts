// The print allow-list (X2 P6.1 Step 1; X2 spec section 4.6, "The print allow-list"). Ring L1. It RUNS in the worker: the render job
// (the parse worker's lazy chunk) imports it statically and calls it on the parsed render output. It is ALSO imported on the main
// thread, by `docs/print/printTree.ts` (the leaf builders pass their small hand-built trees through it: no document, no parse) and
// by the print view's types. It imports NOTHING at runtime (`import type` from `hast` only; no html parser, which only
// `renderTree.ts` imports, in the worker chunk), so the main bundle carries the allow-list and never the parser. It is pure and
// total: it reads a hast tree and answers a `PrintTree`, and it never throws, whatever the tree holds.
//
// What it is. The print view is built from the shared Markdown library's own render output: the worker parses that html into a
// hast tree (`renderTree.ts#parseRendered`) and this module keeps only what the allow-list admits, as plain data (strings,
// numbers, booleans, arrays), so the tree survives a structured clone across the worker boundary. The console then builds the
// view from the tree with React, every value a prop or a child, so no string from the document is ever parsed as HTML in the
// console's document. The allow-list is the wall a string input needs; it keeps elements and attributes BY NAME, and a name it
// does not know is dropped.
//
// The rule (spec 4.6). An element whose name is in `PRINT_ELEMENTS` is kept with only these attributes:
//   - `id`, prefixed (`PRINT_ID_PREFIX`), and every in-document `#x` link rewritten to `#` + prefix + `x`, so no id the document
//     chose lands bare in the console's document (no named-global clobbering, no `getElementById` collision);
//   - `class`, only the names in `PRINT_CLASSES`, so a document cannot match the console's own styles;
//   - `data-line` (`a-b`), `open` (a `details` always prints open), `colspan` and `rowspan` (integers 1 to 1000), `align`, `alt`
//     and `title`, and `start` on `ol`;
//   - `href` on `a` only as an in-document fragment; any other `href` is dropped and its raw text kept as `target`, so the
//     console decides later whether a target prints, never this tree;
//   - an `img`'s `src` is never kept: its raw value is kept as `imgRef`, which the console maps to a URL it already loaded, or
//     else prints the alt text;
//   - an `input` is kept only as a disabled checkbox (`type`, `disabled`, and `checked` when it is), with its classes.
// Every other attribute is dropped: `style`, every `on*` handler, `srcset`, `src` (except as `imgRef`), `xmlns`, anything.
// An element NOT in the list is dropped and its children are processed in its place, so its subtree's text is kept. Comments and
// doctypes are dropped. `svg` and `math` elements (any namespace) are dropped, their text kept, and so is every element inside one.
//
// The two lists' source. `PRINT_ELEMENTS` and `PRINT_CLASSES` are the elements and the classes the shared library's conformance
// output (`@synapsium-labs/pinax-lib` 1.2.0, `conformance/expected/**/*.html`) emits, no more and no fewer: `print-tree.test.ts`
// holds each equal to what it reads from those goldens, so a library bump that adds an element or a class turns that suite red
// until this file is widened to the new output and no further (P5.5 re-takes them from the print mode's output the same way).
//
// Departures from the spec's prose, each deliberate; the library's OUTPUT governs, as the two equality tests say:
//   1. The element list is the output's 37 names, not the prose list. The prose names `del`; the library writes strikethrough as
//      `s`, so `s` is in and `del` is out (a `del` the document smuggled in is dropped, its text kept). The goldens hold no `h4` to
//      `h6`, `ins`, `mark` or `cite`, so none is listed.
//   2. `start` (an ordered list's first number) is an attribute the library writes and the prose does not name; it is kept on `ol`.
//   3. The spec keeps the text of any dropped element. This is stricter for `script`, `style`, `template`, `noscript`, `iframe`,
//      `object` and `embed`: their whole subtree is dropped, text included, because the text of those is code, not prose.
//   4. Table alignment arrives from the library as `style="text-align:center"`; `style` is never kept, so an alignment that is
//      exactly one `text-align: left|center|right` declaration becomes `align` (an `align` attribute, if present, wins).
//   5. `colspan`, `rowspan`, `start` and `href` are bounded and typed as above (spec: by name only), and `href` and `target` are
//      read on `a` only; on any other element they are dropped.
import type { Element, Root } from 'hast';

/** The elements the print view admits: exactly the 37 the library's conformance output emits (header, departure 1). */
export const PRINT_ELEMENTS = Object.freeze([
  'a', // a link: an in-document fragment, or its target printed as text
  'blockquote', // a quote
  'br', // a hard line break
  'code', // inline code and a fence's code
  'dd', // a definition
  'details', // a collapsible block (printed open)
  'div', // a callout, a code wrapper, a table wrapper, a figure's stage
  'dl', // a definition list
  'dt', // a definition term
  'em', // emphasis
  'figcaption', // a figure's caption
  'figure', // a figure (a Mermaid source, an image)
  'h1', // a heading
  'h2', // a heading
  'h3', // a heading
  'hr', // a thematic break
  'img', // an image: its ref, never its src
  'input', // a task list's checkbox, only ever disabled
  'kbd', // a key
  'li', // a list item
  'ol', // an ordered list
  'p', // a paragraph
  'pre', // preformatted text
  's', // strikethrough (the library's spelling of the prose's `del`)
  'section', // the footnotes section
  'span', // a comment anchor and an inline wrapper
  'strong', // strong emphasis
  'sub', // a subscript
  'summary', // a details' summary line
  'sup', // a superscript and a footnote reference
  'table', // a table
  'tbody', // a table body
  'td', // a table cell
  'th', // a table header cell
  'thead', // a table head
  'tr', // a table row
  'ul', // a bulleted list
] as const);

/** The classes the print view admits: exactly the 21 the library's conformance output emits (header). */
export const PRINT_CLASSES = Object.freeze([
  'codehilite', // a highlighted fence's wrapper
  'contains-task-list', // a list holding task items
  'doc-anchor', // a comment anchor's span
  'doc-meta', // the front matter's block
  'footnote-backref', // a footnote's way back
  'footnote-item', // one footnote
  'footnote-ref', // a footnote reference
  'footnotes', // the footnotes section
  'footnotes-list', // the footnotes' list
  'footnotes-sep', // the rule above the footnotes
  'gh-alert', // a callout
  'gh-alert-title', // a callout's title line
  'gh-important', // a callout kind
  'gh-note', // a callout kind
  'gh-tip', // a callout kind
  'gh-warning', // a callout kind
  'mermaid', // a Mermaid fence's source
  'mermaid-figure', // a Mermaid figure
  'table-wrapper', // the scroll wrapper of a table
  'task-list-item', // a task item
  'task-list-item-checkbox', // a task item's checkbox
] as const);

/** A tag the print view admits. */
export type PrintTag = (typeof PRINT_ELEMENTS)[number];

/** The attributes a kept element carries. Every key is optional; a key is present only when the allow-list admitted it. */
export interface PrintAttrs {
  id?: string;
  className?: readonly string[];
  dataLine?: string;
  open?: true;
  colSpan?: number;
  rowSpan?: number;
  align?: 'left' | 'center' | 'right';
  alt?: string;
  title?: string;
  start?: number;
  href?: string;
  /** The raw `href` the tree did not keep as a link: the console decides whether it prints. */
  target?: string;
  /** An `img`'s raw `src`: the console maps it to a URL it already loaded, or prints the alt text. */
  imgRef?: string;
  type?: 'checkbox';
  checked?: true;
  disabled?: true;
}

/** One node of a print tree: plain data, so it survives a structured clone. */
export type PrintNode =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'el'; readonly n: PrintTag; readonly a: PrintAttrs; readonly c: readonly PrintNode[] };

/** A print tree: the nodes of a document, or of a leaf. */
export interface PrintTree { readonly nodes: readonly PrintNode[] }

/** The prefix of every id in the print view. */
export const PRINT_ID_PREFIX = 'docs-print-';

const ELEMENT_SET: ReadonlySet<string> = new Set(PRINT_ELEMENTS);
const CLASS_SET: ReadonlySet<string> = new Set(PRINT_CLASSES);
/** Elements dropped with their whole subtree, text included (header, departure 3). */
const DROP_WHOLE: ReadonlySet<string> = new Set(['script', 'style', 'template', 'noscript', 'iframe', 'object', 'embed']);
/** Elements that open a foreign namespace: dropped, and so is every element inside, their text kept. */
const FOREIGN: ReadonlySet<string> = new Set(['svg', 'math']);

const DATA_LINE_RE = /^\d+-\d+$/;
const UINT_RE = /^\d+$/;
const ALIGN_STYLE_RE = /^\s*text-align\s*:\s*(left|center|right)\s*;?\s*$/i;

/** The element's properties by lower-cased name without hyphens (`dataLine`, `data-line` and `DATALINE` are one key), so a tree
 *  from the parser (`className`, `colSpan`) and a hand-built one (`class`, `colspan`) read the same. Never throws. */
function propsOf(el: object): Map<string, unknown> {
  const out = new Map<string, unknown>();
  let p: unknown;
  try { p = (el as { properties?: unknown }).properties; } catch { return out; }
  if (typeof p !== 'object' || p === null) return out;
  let keys: string[];
  try { keys = Object.keys(p); } catch { return out; }
  for (const k of keys) {
    let v: unknown;
    try { v = (p as Record<string, unknown>)[k]; } catch { continue; }
    out.set(k.toLowerCase().replace(/-/g, ''), v);
  }
  return out;
}

/** An unsigned integer from a number or a digit string, or null. */
function uint(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
  if (typeof v === 'string' && UINT_RE.test(v)) { const n = Number(v); return Number.isSafeInteger(n) ? n : null; }
  return null;
}

/** The class names of a `class` value (an array, as the parser gives, or a string), kept when in the vocabulary. */
function classesOf(v: unknown): string[] {
  const names = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/\s+/) : [];
  const out: string[] = [];
  for (const n of names) if (typeof n === 'string' && CLASS_SET.has(n) && !out.includes(n)) out.push(n);
  return out;
}

function alignOf(p: Map<string, unknown>): 'left' | 'center' | 'right' | null {
  const a = p.get('align');
  if (typeof a === 'string') {
    const l = a.trim().toLowerCase();
    if (l === 'left' || l === 'center' || l === 'right') return l;
  }
  const s = p.get('style');
  if (typeof s === 'string') {
    const m = ALIGN_STYLE_RE.exec(s);
    if (m !== null) return (m[1] as string).toLowerCase() as 'left' | 'center' | 'right';
  }
  return null;
}

/** The attributes the allow-list keeps for one element of the list, or null when the element is not kept (an `input` that is not
 *  a checkbox). */
function attrsOf(name: PrintTag, p: Map<string, unknown>, idPrefix: string): PrintAttrs | null {
  const a: PrintAttrs = {};
  const cls = classesOf(p.get('classname') ?? p.get('class'));
  if (name === 'input') {
    const t = p.get('type');
    if (typeof t !== 'string' || t.trim().toLowerCase() !== 'checkbox') return null;
    a.type = 'checkbox';
    a.disabled = true;
    const c = p.get('checked');
    if (c === true || typeof c === 'string') a.checked = true;
    if (cls.length > 0) a.className = cls;
    return a;
  }
  const id = p.get('id');
  if (typeof id === 'string' && id !== '') a.id = idPrefix + id;
  if (cls.length > 0) a.className = cls;
  const line = p.get('dataline');
  if (typeof line === 'string' && DATA_LINE_RE.test(line)) a.dataLine = line;
  if (name === 'details') a.open = true;
  const cs = uint(p.get('colspan'));
  if (cs !== null && cs >= 1 && cs <= 1000) a.colSpan = cs;
  const rs = uint(p.get('rowspan'));
  if (rs !== null && rs >= 1 && rs <= 1000) a.rowSpan = rs;
  const al = alignOf(p);
  if (al !== null) a.align = al;
  const alt = p.get('alt');
  if (typeof alt === 'string') a.alt = alt;
  const title = p.get('title');
  if (typeof title === 'string') a.title = title;
  if (name === 'ol') { const s = uint(p.get('start')); if (s !== null) a.start = s; }
  if (name === 'a') {
    const h = p.get('href');
    if (typeof h === 'string') {
      if (h.length > 1 && h.startsWith('#')) a.href = `#${idPrefix}${h.slice(1)}`;
      else a.target = h;
    }
  }
  if (name === 'img') { const s = p.get('src'); if (typeof s === 'string') a.imgRef = s; }
  return a;
}

/** One unit of the walk: visit a node and append what it yields to `out`, or leave an element (so the cycle guard forgets it). */
type Step =
  | { readonly k: 'visit'; readonly node: unknown; readonly out: PrintNode[]; readonly foreign: boolean }
  | { readonly k: 'leave'; readonly node: object };

/** Push `children` onto the stack so they pop in document order. */
function pushChildren(stack: Step[], el: object, out: PrintNode[], foreign: boolean): void {
  let kids: unknown;
  try { kids = (el as { children?: unknown }).children; } catch { return; }
  if (!Array.isArray(kids)) return;
  for (let i = kids.length - 1; i >= 0; i--) stack.push({ k: 'visit', node: kids[i], out, foreign });
}

/** The print tree of a hast tree under the allow-list (see the header). Pure and total: it never throws, whatever the tree holds
 *  (a property of the wrong type, an element with no properties, a cycle, a child that is not a node), and it is iterative, so a
 *  tree nested 5 000 levels deep cannot overflow the stack. */
export function printAllow(root: Root, o?: { idPrefix?: string }): PrintTree {
  const idPrefix = typeof o?.idPrefix === 'string' ? o.idPrefix : PRINT_ID_PREFIX;
  const nodes: PrintNode[] = [];
  const stack: Step[] = [];
  const onPath = new Set<object>();
  try {
    pushChildren(stack, root as unknown as object, nodes, false);
    for (let s = stack.pop(); s !== undefined; s = stack.pop()) {
      if (s.k === 'leave') { onPath.delete(s.node); continue; }
      const n = s.node;
      if (typeof n !== 'object' || n === null) continue;
      const type = (n as { type?: unknown }).type;
      if (type === 'text') {
        const v = (n as { value?: unknown }).value;
        if (typeof v === 'string' && v !== '') s.out.push({ t: 'text', v });
        continue;
      }
      if (type === 'root') { pushChildren(stack, n, s.out, s.foreign); continue; }
      if (type !== 'element') continue;
      if (onPath.has(n)) continue;
      const tagRaw = (n as Element).tagName;
      const name = typeof tagRaw === 'string' ? tagRaw.toLowerCase() : '';
      if (DROP_WHOLE.has(name)) continue;
      onPath.add(n);
      stack.push({ k: 'leave', node: n });
      const foreign = s.foreign || FOREIGN.has(name);
      const attrs = !foreign && ELEMENT_SET.has(name) ? attrsOf(name as PrintTag, propsOf(n), idPrefix) : null;
      if (attrs === null) { pushChildren(stack, n, s.out, foreign); continue; }
      const el: PrintNode = { t: 'el', n: name as PrintTag, a: attrs, c: [] };
      s.out.push(el);
      pushChildren(stack, n, el.c as PrintNode[], foreign);
    }
  } catch {
    // Total by contract: a tree that defeats the reads above (a getter that throws, a proxy) yields what was built so far.
  }
  return { nodes };
}
