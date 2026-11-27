// The print view (X2 P6.1 Step 1; X2 spec section 4.6, "How" and "The threat: document markup in the console"). Ring L4: a React
// component, built the way Export builds its file, "as React, never as strings" (`export/buildExport.tsx`): every value from a
// document enters as a prop or a child, so it is escaped, and no string is ever parsed as HTML here. Nothing in this folder uses
// React's raw-HTML prop (`docs-print.test.tsx` scans every file here for it by name).
//
// The tree it draws is a `PrintTree` the worker's allow-list already made (`lib/printAllow.ts`: the element names, the attributes
// and the classes it keeps are closed lists), and this view only ever creates an element whose tag name is in `PRINT_ELEMENTS`
// and gives it the props `PrintAttrs` has a slot for: `className` joined, `id`, `data-line`, `open`, `colSpan`, `rowSpan`,
// `align` (the attribute, never `style`: this view sets no `style` at all), `alt`, `title`, `start`, and `href` only when the
// tree kept one, which is an in-document fragment. What the tree could not keep, this view decides here:
//   - an `img` takes `src` only from `images`, the URLs the page already loaded, keyed by the tree's `imgRef`; with none it
//     prints its alt text in brackets, as text;
//   - an `a` that carries a `target` (a link the tree did not keep as a link) prints its text, and then ` (<url>)` as text when
//     `linkTarget(target)` answers one: a doc link's address, or nothing for a link the console does not print;
//   - a task item's `input` is a disabled, read-only checkbox, `checked` as the tree says.
// The view draws, in order: the drafts banner when one is given (a `p.docs-print-banner`, from `export/provenance.ts#exportProvenance`,
// so a printed draft is never mistaken for a committed doc), then each part: a `tree` part node by node, a `plain` part as its
// `why` in `p.docs-print-note` and its text in one `pre`. A part after the first is in a `div.docs-print-part`, which the print
// stylesheet starts on a new page. When `line` is set (Ctrl+P before the tree is ready, or a PDF or an HTML page, which print from
// their file) the view holds that one line in a `p` and nothing else. Keys are positions.
import { createElement, Fragment, type ReactElement, type ReactNode } from 'react';
import type { PrintAttrs, PrintNode } from '../../lib/printAllow';
import type { PrintPart } from './preparePrint';

export interface PrintViewProps {
  readonly parts: readonly PrintPart[];
  /** The drafts banner (`exportProvenance`'s `banner`), or `null` for a committed doc. */
  readonly banner: string | null;
  /** The URLs the page already loaded, by the `imgRef` a render image carries. */
  readonly images: ReadonlyMap<string, string>;
  /** The text a link's raw target prints after the link's text: its address, or `null` for a link that prints no address. */
  readonly linkTarget: (raw: string) => string | null;
  /** The one line the view holds instead of the document, or `null`. */
  readonly line: string | null;
  /** Said at the top of the view, after the banner, when the document is too long to print whole and `parts` is the part on screen
   *  (`printPlan.ts`, the whole-print ceiling); absent or `null`: nothing to say. */
  readonly notice?: string | null;
}

interface Env {
  readonly images: ReadonlyMap<string, string>;
  readonly linkTarget: (raw: string) => string | null;
}

/** The element's props from what the allow-list kept (see the header). No `style`, no handler, ever. */
function propsOf(a: PrintAttrs): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (a.id !== undefined) p['id'] = a.id;
  if (a.className !== undefined && a.className.length > 0) p['className'] = a.className.join(' ');
  if (a.dataLine !== undefined) p['data-line'] = a.dataLine;
  if (a.open === true) p['open'] = true;
  if (a.colSpan !== undefined) p['colSpan'] = a.colSpan;
  if (a.rowSpan !== undefined) p['rowSpan'] = a.rowSpan;
  if (a.align !== undefined) p['align'] = a.align;
  if (a.alt !== undefined) p['alt'] = a.alt;
  if (a.title !== undefined) p['title'] = a.title;
  if (a.start !== undefined) p['start'] = a.start;
  if (a.href !== undefined) p['href'] = a.href;
  return p;
}

/** The elements that take no children. */
const VOID: ReadonlySet<string> = new Set(['br', 'hr', 'img', 'input']);

/** One node of a print tree, drawn as its own component so React walks a deep tree iteratively. */
function PrintNodeView({ node, env }: { readonly node: PrintNode; readonly env: Env }): ReactElement | string {
  if (node.t === 'text') return node.v;
  const { n, a } = node;
  if (n === 'img') {
    const url = a.imgRef === undefined ? undefined : env.images.get(a.imgRef);
    if (url === undefined) return createElement(Fragment, null, `[${a.alt !== undefined && a.alt !== '' ? a.alt : 'image'}]`);
    return createElement('img', { ...propsOf(a), src: url });
  }
  if (n === 'input') {
    return createElement('input', {
      type: 'checkbox', disabled: true, readOnly: true, ...(a.checked === true ? { checked: true } : {}),
      ...(a.className !== undefined && a.className.length > 0 ? { className: a.className.join(' ') } : {}),
    });
  }
  const kids = VOID.has(n) ? [] : childrenOf(node.c, env);
  const el = createElement(n, propsOf(a), ...kids);
  if (n === 'a' && a.target !== undefined) {
    const to = env.linkTarget(a.target);
    if (to !== null) return createElement(Fragment, null, el, ` (${to})`);
  }
  return el;
}

function childrenOf(nodes: readonly PrintNode[], env: Env): ReactNode[] {
  return nodes.map((c, i) => createElement(PrintNodeView, { key: i, node: c, env }));
}

function PartView({ part, env }: { readonly part: PrintPart; readonly env: Env }): ReactElement {
  if (part.kind === 'plain') {
    return createElement(Fragment, null,
      createElement('p', { className: 'docs-print-note' }, part.why),
      createElement('pre', null, part.text));
  }
  return createElement(Fragment, null, ...childrenOf(part.tree.nodes, env));
}

/** The print view (see the header). */
export function PrintView(p: PrintViewProps): ReactElement {
  if (p.line !== null) return <div className="docs-print-view"><p className="docs-print-line">{p.line}</p></div>;
  const env: Env = { images: p.images, linkTarget: p.linkTarget };
  return (
    <div className="docs-print-view">
      {p.banner === null ? null : <p className="docs-print-banner">{p.banner}</p>}
      {p.notice == null ? null : <p className="docs-print-notice">{p.notice}</p>}
      {p.parts.map((part, k) => (
        <div key={k} className={k === 0 ? undefined : 'docs-print-part'}>
          <PartView part={part} env={env} />
        </div>
      ))}
    </div>
  );
}
