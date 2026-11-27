// What Print draws from what is published and prepared (X2 P6.1 Step 1, part B; spec 4.6). Ring L1: pure decisions, no I/O, no
// DOM, no clock. `usePrint` (L4) holds the state and the listeners; every question it asks of them is answered here.
//
// A source is `prepared` one slot per part: a `PrintPart` once its tree (or its plain reason) is in, `null` while it is not.
//   - a Markdown text is one part, prepared by the worker once the frame is `ready`;
//   - a Markdown text in parts has one slot a part, prepared in order once the cut is whole;
//   - a text leaf and an image leaf are drawn at once from the console's own builders (`leafPrintTree`: no worker, nothing to wait for);
//   - a PDF or an HTML page prints one line and no document.
// The plan is `{ parts, line, notice }`: the print view's inputs. `null`: nothing is published, so there is no print view and the
// browser prints the page as it is. With nothing prepared at all the plan is the one line "Docs is preparing this page for
// print; print again in a moment."; a part not yet prepared, beside a prepared one, prints as its plain text under
// `PRINT_NOT_READY`.
//
// THE WHOLE-PRINT CEILING (D-9163). A document in parts prints every part (PL3) only while the prepared trees hold at most
// `PRINT_WHOLE_MAX_ELEMENTS` elements; above it the plan holds the part on screen alone, with `notice` saying so and how to print the
// rest, so Print is never a silent short print and never the tap that kills the tab. The measure is counted here, from what is
// prepared, before anything mounts. Part-by-part printing and lifting the ceiling are P5.5's (D-9163).
import type { DocListPin, DocPin, DocsPageLocation, DocsTreeOk } from '../../../../shared/docs';
import type { PrintNode } from '../../lib/printAllow';
import type { DocLinkContextValue } from '../DocLink';
import { docLinkTarget } from '../docsLinks';
import { exportProvenance } from '../export/provenance';
import type { DocsVisit } from '../useDocsVisit';
import type { PrintPart } from './preparePrint';
import type { PrintSource } from './printSource';
import { leafPrintTree } from './printTree';
import { PRINT_HTML_LINE, PRINT_NOT_READY, PRINT_PDF_LINE, PRINT_PREPARING_LINE, PRINT_TOO_LONG } from './printWords';

/** One slot a part; `null` while the part is not prepared. */
export type Prepared = readonly (PrintPart | null)[];

/** The most elements a whole print mounts: 120 000 (D-9163). Measured on the browser leg: the 3.4 MiB fixture's whole print is 7 parts and
 *  367 866 elements, heap 425 MiB mounted and a resident peak of 5.5 to 6 GiB, which the 6 GiB test slice kills in most runs; the cost
 *  scales with the elements, about 54 000 a render gate (2 parts, about 110 000 elements, 140 MiB mounted, peak about 3.0 GiB; 4 parts,
 *  about 216 000, 258 MiB, about 4.1 GiB). So Print must never be the tap that kills the tab: at or below this a document prints every
 *  part (PL3); above it, only the part on screen, with a sentence that says so (`PRINT_TOO_LONG`). Part-by-part printing and lifting
 *  this ceiling are P5.5's (D-9163). */
export const PRINT_WHOLE_MAX_ELEMENTS = 120000;

export interface PrintPlan {
  readonly parts: readonly PrintPart[];
  /** The one line the view holds instead of a document, or `null`. */
  readonly line: string | null;
  /** Said at the top of the view and below the Print row when the document is too long to print whole (`parts` is then the one part on
   *  screen), else `null`. */
  readonly notice: string | null;
}

/** The elements (`el` nodes) of the trees among `parts`: the measure of a whole print's weight. Iterative; a plain part holds none. */
export function printElementCount(parts: readonly (PrintPart | null)[]): number {
  let n = 0;
  for (const part of parts) {
    if (part === null || part.kind !== 'tree') continue;
    const stack: PrintNode[] = [...part.tree.nodes];
    for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
      if (x.t !== 'el') continue;
      n += 1;
      for (const c of x.c) stack.push(c);
    }
  }
  return n;
}

/** How many parts the source prints as: a Markdown text one, a text its parts, the others none to wait for. */
export function printTotal(source: PrintSource): number {
  switch (source.kind) {
    case 'markdown': return 1;
    case 'markdown-parts': return source.parts.length;
    case 'text': return source.parts.length;
    case 'image': return 1;
    case 'download-to-print': return 0;
  }
}

/** Whether the source's trees come from the worker (and so wait for it); a text or an image leaf draws at once. */
export function fromWorker(source: PrintSource): boolean {
  return source.kind === 'markdown' || source.kind === 'markdown-parts';
}

/** Whether the source can be asked of the worker yet: a Markdown text once its frame is ready, parts once the cut is whole. */
export function prepStarted(source: PrintSource): boolean {
  return source.kind === 'markdown' ? source.ready : source.kind === 'markdown-parts' ? source.complete && source.parts.length > 0 : true;
}

/** What the worker is asked to prepare, and what its answer is kept under (review 4116, A2: `usePrint` reads this, so the gate is
 *  `prepStarted`'s alone): a Markdown text's text, the parts' array itself (a new cut is a new array, and starts again); `null`
 *  while there is nothing for the worker to prepare (no source, a source drawn at once, or one `prepStarted` holds back). */
export function prepKeyOf(source: PrintSource | null): string | readonly string[] | null {
  if (source === null || !fromWorker(source) || !prepStarted(source)) return null;
  return source.kind === 'markdown' ? source.text : source.kind === 'markdown-parts' ? source.parts : null;
}

/** The trees of a text or an image leaf, drawn at once; `null` for any other source. */
export function leafPrepared(source: PrintSource): readonly PrintPart[] | null {
  if (source.kind === 'image') return [{ kind: 'tree', tree: leafPrintTree({ kind: 'image', src: source.src, name: source.name }) }];
  if (source.kind !== 'text') return null;
  const n = source.parts.length;
  return source.parts.map((text, i) => ({
    kind: 'tree' as const, tree: leafPrintTree({ kind: 'text', text, name: source.name, part: n > 1 ? { k: i + 1, n } : null }),
  }));
}

/** Whether everything the source will give is prepared, so Print has nothing left to wait for. */
export function prepSettled(source: PrintSource, prepared: Prepared): boolean {
  if (!fromWorker(source)) return true;
  const n = printTotal(source);
  return prepStarted(source) && n > 0 && prepared.length >= n && prepared.slice(0, n).every((p) => p !== null);
}

/** The part Print is waiting for, 1-based, and how many there are: the first not prepared. */
export function printProgress(source: PrintSource, prepared: Prepared): { readonly k: number; readonly n: number } {
  const n = Math.max(1, printTotal(source));
  const done = prepared.findIndex((p) => p === null);
  const have = done === -1 ? prepared.length : done;
  return { k: Math.min(n, have + 1), n };
}

/** The view's inputs for what is published and prepared; `null` when nothing is published (no print view is mounted). */
export function printPlanFor(source: PrintSource | null, prepared: Prepared): PrintPlan | null {
  if (source === null) return null;
  if (source.kind === 'download-to-print') {
    return { parts: [], line: source.cls === 'pdf' ? PRINT_PDF_LINE : PRINT_HTML_LINE, notice: null };
  }
  const leaf = leafPrepared(source);
  if (leaf !== null) return withinCeiling(source, leaf);
  const texts = source.kind === 'markdown' ? [source.text] : source.kind === 'markdown-parts' ? source.parts : [];
  if (!texts.some((_, k) => (prepared[k] ?? null) !== null)) return { parts: [], line: PRINT_PREPARING_LINE, notice: null };
  return withinCeiling(source, texts.map((text, k): PrintPart => prepared[k] ?? { kind: 'plain', text, why: PRINT_NOT_READY }));
}

/** Every part when the whole print is at most `PRINT_WHOLE_MAX_ELEMENTS` elements (PL3); above it, the part on screen alone (`source.at`)
 *  and the sentence that says so, decided here before anything mounts. A source with one part has no part to choose. */
function withinCeiling(source: PrintSource, parts: readonly PrintPart[]): PrintPlan {
  if ((source.kind === 'markdown-parts' || source.kind === 'text') && parts.length > 1 && printElementCount(parts) > PRINT_WHOLE_MAX_ELEMENTS) {
    const at = Math.min(Math.max(0, source.at), parts.length - 1);
    return { parts: [parts[at] as PrintPart], line: null, notice: PRINT_TOO_LONG };
  }
  return { parts, line: null, notice: null };
}

/** Whether a prepared part is a part that was let go at its wait (`preparePartsPrint`): it printed as plain text under
 *  `PRINT_NOT_READY`, and the next press asks the worker for it again. */
export function isNotReady(part: PrintPart | null | undefined): boolean {
  return part !== null && part !== undefined && part.kind === 'plain' && part.why === PRINT_NOT_READY;
}

/** The pin the page opened: the range read's for a document read by range (a stat-pinned draft's carries its snapshot digest), else
 *  the file slot's, else `listed`, the listing's pin (`pinFor`'s; a raster leaf has no file slot). `null`: nothing opened, or a draft
 *  with no fingerprint (its bytes were not read). */
export function openedPinOf(visit: Pick<DocsVisit, 'file' | 'rangeOpened'>, listed: DocListPin | null): DocPin | null {
  if (visit.rangeOpened !== null) return visit.rangeOpened.pin;
  if (visit.file.s === 'ok') return visit.file.pin;
  return listed === null || (listed.kind === 'draft' && listed.fp === null) ? null : listed;
}

/** The drafts banner Print draws at the top: `exportProvenance`'s for the pin the page opened, by Export's own decision, so a
 *  printed draft is never mistaken for a committed doc. `null`: a committed doc, or a page that opened nothing. */
export function bannerFor(i: {
  readonly page: DocsPageLocation | null; readonly tree: DocsTreeOk | null; readonly listed: DocListPin | null;
  readonly visit: Pick<DocsVisit, 'file' | 'rangeOpened'>;
}): string | null {
  const { page, tree, visit } = i;
  if (page === null || tree === null || page.kind !== 'path') return null;
  const pin = openedPinOf(visit, i.listed);
  if (pin === null) return null;
  const readAt = visit.rangeOpened?.readAt ?? (visit.file.s === 'ok' ? visit.file.receivedAt : 0);
  const show = visit.file.s === 'ok' ? visit.file.answer.show : null;
  return exportProvenance({ tree, page, pin, show, exportedAt: readAt, readAt, plainView: false }).banner;
}

/** What a printed link adds after its words: a doc link's in-app target (`docLinkTarget`'s decision) as an absolute address on
 *  `origin`, and nothing for any other link (an external one, a repo file, a refused one). `link` null: no page, so none. */
export function printLinkTarget(link: DocLinkContextValue | null, origin: string): (raw: string) => string | null {
  return (raw) => {
    if (link === null) return null;
    const t = docLinkTarget(link, raw);
    return t.kind === 'in-app' ? origin + t.href + (t.fragment === null ? '' : '#' + t.fragment) : null;
  };
}

/** The URLs the trees' images print from: the frame's own for a ref it loaded, else what `loaded` answers (the page's registry of
 *  images it already loaded, `printImages.ts`), else none: a ref in neither is not here, and prints its alt text. Never the ref
 *  itself, so a document cannot make the print load a URL it chose. */
export function imagesFor(
  refs: readonly string[], frame: Readonly<Record<string, string>> | undefined, loaded: (ref: string) => string | null,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const ref of refs) {
    if (frame !== undefined && Object.hasOwn(frame, ref)) { out.set(ref, frame[ref] as string); continue; }
    const url = loaded(ref);
    if (url !== null) out.set(ref, url);
  }
  return out;
}

/** Every distinct `imgRef` a part's tree holds, in document order. Iterative. */
export function imgRefsOf(parts: readonly PrintPart[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    if (part.kind !== 'tree') continue;
    const stack: PrintNode[] = [...part.tree.nodes].reverse();
    for (let n = stack.pop(); n !== undefined; n = stack.pop()) {
      if (n.t !== 'el') continue;
      const ref = n.a.imgRef;
      if (ref !== undefined && !seen.has(ref)) { seen.add(ref); out.push(ref); }
      for (let i = n.c.length - 1; i >= 0; i -= 1) stack.push(n.c[i] as PrintNode);
    }
  }
  return out;
}
