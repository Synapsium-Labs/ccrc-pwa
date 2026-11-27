// Preparing the print trees (X2 P6.1 Step 1; X2 spec section 4.6, "The tree is parsed ahead"; PL3). Ring L1 where it can be: it
// imports pure modules only (limits, words, the byte counter) and TYPES of the render job, and it takes the render port as an
// argument, so it names no worker, no runner and no DOM. The one clock it reads is a deadline inside one call (`preparePartsPrint`
// keeps the handle of each part's timer as a local), which is not a scheduler.
//
// - `preparePrintTree(src, render, signal)` asks the render job for the print tree of one Markdown source, under
//   `DOCS_PARSE_BUDGET_MS` of the source's UTF-8 bytes (the budget the reader's own parse of it has). The tree is the job's, made
//   by the same render, the html parse and the allow-list in the worker: nothing is parsed here. A refusal, an outcome that is
//   not a rendered page with a tree, a timeout or a throw gives a `plain` part, the source as text under the sentence that says
//   why (`printWords.ts`). Only the caller's own abort rejects.
// - `preparePartsPrint(parts, render, signal, onPart)` prepares a Markdown doc read in parts, one part at a time, each under its
//   own budget, and Print waits at most `PRINT_WAIT_MS` for one: a part still not ready then is cancelled (the runner ends its
//   job) and prints as plain text under `PRINT_NOT_READY`. It answers every part, in order, and tells `onPart` each as it lands,
//   so a caller can show "Preparing part k of n".
import { utf8Bytes } from '../../../../shared/utf8';
import { DOCS_PARSE_BUDGET_MS } from '../../lib/markdownLimits';
import type { PrintTree } from '../../lib/printAllow';
import type { ReaderRenderOutcome } from '../../lib/readerRenderJob';
import { PRINT_WAIT_MS } from './printTree';
import { PRINT_NOT_READY, printPlainWhy, printThrewWhy } from './printWords';

/** What the print view draws for one part: the allow-listed tree, or the part's text under the reason it is plain. */
export type PrintPart =
  | { readonly kind: 'tree'; readonly tree: PrintTree }
  | { readonly kind: 'plain'; readonly text: string; readonly why: string };

/** The render job as the print asks it: the reader's render, with `print: true` (`MarkdownRunner['render']` fits it). */
export type PrintRender = (
  src: string, o: { budgetMs: number; signal?: AbortSignal; print: true },
) => Promise<ReaderRenderOutcome>;

/** The name of whatever was thrown: `name` for an error, else its `typeof`. */
function thrownName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

/** The print part of one Markdown source (see the header). Rejects only when `signal` aborted. */
export async function preparePrintTree(src: string, render: PrintRender, signal: AbortSignal): Promise<PrintPart> {
  let out: ReaderRenderOutcome;
  try {
    out = await render(src, { budgetMs: DOCS_PARSE_BUDGET_MS(utf8Bytes(src)), signal, print: true });
  } catch (e) {
    if (signal.aborted) throw e;
    return { kind: 'plain', text: src, why: printThrewWhy(thrownName(e)) };
  }
  if (out.kind === 'rendered' && out.printTree !== undefined) return { kind: 'tree', tree: out.printTree };
  return { kind: 'plain', text: src, why: printPlainWhy(out) };
}

/** One part, prepared within `PRINT_WAIT_MS`: the part's own render is cancelled when the wait ends. */
async function preparedWithin(src: string, render: PrintRender, signal: AbortSignal): Promise<PrintPart> {
  const own = new AbortController();
  const stop = (): void => own.abort(signal.reason);
  signal.addEventListener('abort', stop, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<PrintPart>((resolve) => {
    timer = setTimeout(() => { resolve({ kind: 'plain', text: src, why: PRINT_NOT_READY }); own.abort(new DOMException('not ready', 'TimeoutError')); }, PRINT_WAIT_MS);
  });
  const work = preparePrintTree(src, render, own.signal);
  // The loser of the race is never awaited: an abort of its job after the wait ended rejects it, and that is no one's error.
  work.catch(() => undefined);
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

/** Every part of a Markdown doc read in parts, prepared in order, one at a time (see the header). `onPart(k, part)` is told each
 *  as it lands (k is 0-based). Rejects with the signal's reason when it aborts. */
export async function preparePartsPrint(
  parts: readonly string[], render: PrintRender, signal: AbortSignal, onPart: (k: number, part: PrintPart) => void,
): Promise<PrintPart[]> {
  const all: PrintPart[] = [];
  for (let k = 0; k < parts.length; k += 1) {
    signal.throwIfAborted();
    const part = await preparedWithin(parts[k] as string, render, signal);
    signal.throwIfAborted();
    all.push(part);
    onPart(k, part);
  }
  return all;
}
