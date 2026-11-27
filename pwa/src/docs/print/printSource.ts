// What is on the page, for print (X2 P6.1 Step 1, part B; spec 4.6 "The tree is parsed ahead"). The model is `docs/exportBody.ts`: each body
// publishes what it shows, in an effect, while it is mounted, and withdraws it (`null`) in that effect's cleanup; the Docs screen
// holds the one slot (`usePrint` reads it). A leaf mounts one body at a time, so React runs the leaving body's cleanup before the
// next body's effect, and the slot always ends on the body on screen.
//   - `markdown`: a Markdown source shown by the reader frame (or its plain view): its text and whether the frame has reported `ready`.
//     Print asks the worker for the print tree only once `ready` is true. `images`: the `data:` URLs the frame's own images came to,
//     under the ref the render gave each, which the print view prints (an image not in it prints its alt text);
//   - `markdown-parts`: a Markdown text read in parts (`MarkdownParts`): each part's text as it mounts, whether the cut is whole, and
//     `at`, the 0-based part the page shows now (the part a document too long to print whole prints, `printPlan.ts`);
//   - `text`: a text leaf, whole (one part) or in parts (`SourceParts`), with the file's name and `at`, the part on screen;
//   - `image`: an image leaf: the URL the leaf already shows (an object URL, or the SVG data URL its `img` draws) and the file's name;
//   - `download-to-print`: a PDF or an HTML page, which print from their downloaded file (PL4, PL5).
// `NoPrintSource` withdraws the slot from what is drawn inside it: the parts' own bodies (each part's frame or source) are drawn
// inside it, so the one body that owns the whole document (`MarkdownParts`, `SourceParts`) is the one that publishes.
//
// Ring L4 (a hook and a context).
import { createContext, createElement, useContext, useEffect, type ReactNode } from 'react';

export type PrintSource =
  | { readonly kind: 'markdown'; readonly text: string; readonly ready: boolean; readonly images?: Readonly<Record<string, string>> }
  | { readonly kind: 'markdown-parts'; readonly parts: readonly string[]; readonly complete: boolean; readonly at: number }
  | { readonly kind: 'text'; readonly parts: readonly string[]; readonly name: string; readonly at: number }
  | { readonly kind: 'image'; readonly src: string; readonly name: string }
  | { readonly kind: 'download-to-print'; readonly cls: 'pdf' | 'html' };

/** Where a body publishes. `null`, the default, has one meaning: nothing listens (a body outside the Docs screen). */
export const PrintSourceContext = createContext<((source: PrintSource | null) => void) | null>(null);

const NOBODY = (): void => {};

/** Publishes `source` while it stands and the component is mounted; `null` publishes nothing. The caller memoises `source`. */
export function usePublishPrintSource(source: PrintSource | null): void {
  const publish = useContext(PrintSourceContext);
  useEffect(() => {
    if (publish === null || source === null) return undefined;
    publish(source);
    return () => publish(null);
  }, [publish, source]);
}

/** Draws `children` with nobody listening for a print source: a part's own body inside the parts' owner publishes nothing. */
export function NoPrintSource(p: { readonly children: ReactNode }): ReactNode {
  return createElement(PrintSourceContext, { value: NOBODY }, p.children);
}
