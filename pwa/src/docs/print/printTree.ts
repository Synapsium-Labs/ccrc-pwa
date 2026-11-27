// The print trees of a leaf, and what a content class offers for print (X2 P6.1 Step 1; X2 spec section 4.6, "Print by leaf kind").
// Ring L1, main thread: pure builders, no I/O. A leaf is not Markdown, so there is no render output to parse; the console builds a
// small hast tree for it and passes it through `printAllow` exactly as a render's tree goes through it, so one allow-list is the
// wall for every print and the console renders the result with React (never a string parsed as HTML).
//
// - An image leaf is `figure > img + figcaption`. The leaf's own URL (an image the page has already loaded, handed in by the leaf
//   view, never one read from a document) is the `img`'s `src`; the allow-list moves it to `imgRef`, which the console maps back.
// - A text leaf is one `pre` whose only child is the text as a text node: markup in it stays text. A text read in parts adds a
//   `p` line above it, "Part k of n", as plain text.
// - A PDF and an HTML page print from their downloaded file, so the console offers Download to print and no Print (PL4, PL5).
import type { Element, ElementContent, Root } from 'hast';
import type { DocContentClass } from '../../../../shared/docs';
import { printAllow, type PrintTree } from '../../lib/printAllow';

/** The longest Print in Page details waits for a part's print tree (spec 4.6: 10 s a part). */
export const PRINT_WAIT_MS = 10000;

/** What the Print row offers for a content class: Print itself, or Download to print (a PDF and an HTML page print from their
 *  downloaded file, and the console's window cannot print them). */
export function printOffer(cls: DocContentClass): 'print' | 'download-to-print' {
  return cls === 'pdf' || cls === 'html' ? 'download-to-print' : 'print';
}

/** A leaf the print view draws. */
export type PrintLeaf =
  | { readonly kind: 'image'; readonly src: string; readonly name: string }
  | { readonly kind: 'text'; readonly text: string; readonly name: string; readonly part: { readonly k: number; readonly n: number } | null };

const el = (tagName: string, properties: Element['properties'], children: ElementContent[]): Element =>
  ({ type: 'element', tagName, properties, children });

const text = (value: string): ElementContent => ({ type: 'text', value });

/** The print tree of one leaf, through `printAllow` (see the header). */
export function leafPrintTree(leaf: PrintLeaf): PrintTree {
  const children: Root['children'] = [];
  if (leaf.kind === 'image') {
    children.push(el('figure', {}, [el('img', { src: leaf.src, alt: leaf.name }, []), el('figcaption', {}, [text(leaf.name)])]));
  } else {
    if (leaf.part !== null) children.push(el('p', {}, [text(`Part ${leaf.part.k} of ${leaf.part.n}`)]));
    children.push(el('pre', {}, [text(leaf.text)]));
  }
  return printAllow({ type: 'root', children });
}
