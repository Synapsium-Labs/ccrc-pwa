// The reader's render job, worker side (native Docs reader, W8a Task 4; the rich-docs spec's (amended 2026-10-31) A6 and
// M8.21, base design section 4.10's worker and timeout outcome). Ring L1: it makes no I/O, and it imports only
// `readerLimits`, `markdownLimits`, `markdownGuard`, `renderTree` (the html parser), `printAllow` (the print allow-list), types from `markdownParse`, and the shared
// Markdown library's renderer entry (the one import of that library in `pwa/src/lib`). It is the worker's LAZY chunk: `markdownWorker.ts`
// reaches it through one literal `import('./readerRenderJob')` on the first `kind: 'render'` message, so the parse
// chunk carries none of the renderer, and on the main thread it is reached only through `import type`.
//
// `answerRenderJob` mirrors `answerMarkdownJob`: a message with no finite numeric `id` is dropped; the pre-scan runs
// first and answers ParseOutcome's own `refused` arm; then the library's `render` under the render gate and
// `READER_HTML_MAX_BYTES`, whose non-`rendered` outcome answers `not-rendered` with the library's own word; then
// `scanRefs` for the page's image refs and Mermaid counts. A non-string `src` answers `threw` `TypeError`. The parse
// and the post are both wrapped: a throw anywhere answers `threw` and the thrown name, a `post` that throws (a
// structured clone's `DataCloneError`) is answered once more, and a throw from that second post is swallowed, so the
// runner's budget answers the job. The runner adds `timeout`, `worker-unavailable` and `worker-failed`.
//
// A job with `blocks: true` (X2 P6.1 Step 0b2, the Markdown parts' cutter) runs the same pre-scan, then the library's `render` under
// its own caps (`READER_BLOCKS_MAX_BYTES`, `READER_BLOCKS_HTML_MAX_BYTES`) with no highlighting, parses the html and answers
// `blocks`: the source's top-level blocks (`renderTree.ts`), and no html, no meta and no image refs. A refusal or a `render`
// that did not render answers as for any job. A job without `blocks` (only `true` counts) is answered exactly as above. The
// parser (`hast-util-from-html`, imported by `renderTree.ts` alone) lives in this lazy chunk with the renderer.
//
// A job with `print: true` (and no `blocks`; X2 P6.1 Step 1, spec 4.6) is the reader's render EXACTLY (`renderOutcome`: the same
// pre-scan, the same caps, one render path), and on `rendered` its answer carries one more field, `printTree`: the html of that
// very render parsed by `renderTree.ts#parseRendered` and passed through `printAllow` (`printAllow.ts`, imported statically, so it
// rides this chunk and the parse runs here, never on the main thread). A parse that throws answers `threw` as any throw does.
// A refusal or a render that did not render answers as for any job, with no tree. A job without `print` (only `true` counts) is
// answered exactly as before, with no `printTree` key; a job with both flags is a `blocks` job.
import { render, scanRefs, type FrontEntry, type Heading, type ScanRefsResult } from '@synapsium-labs/pinax-lib/render';
import { prescanMarkdown } from './markdownGuard';
import { DOCS_RENDER_GATE_BYTES } from './markdownLimits';
import type { ParseOutcome } from './markdownParse';
import { printAllow, type PrintTree } from './printAllow';
import { READER_BLOCKS_HTML_MAX_BYTES, READER_BLOCKS_MAX_BYTES, READER_HTML_MAX_BYTES } from './readerLimits';
import { parseRendered, renderedBlocks, type MdBlock } from './renderTree';

/** One render job for the worker, as the runner posts it. */
export interface ReaderRenderJob {
  readonly id: number;
  readonly kind: 'render';
  readonly src: string;
  /** Ask for the source's top-level blocks instead of the page (the Markdown parts' cutter). */
  readonly blocks?: true;
  /** Ask for the print tree beside the page (X2 P6.1 Step 1): the same render, then the allow-list. Ignored with `blocks`. */
  readonly print?: true;
}

/** The page's facts the reader draws from: the library's meta fields it uses. */
export interface ReaderRenderMeta {
  readonly title: string | null;
  readonly frontList: readonly FrontEntry[] | null;
  readonly headings: readonly Heading[];
  readonly figures: number;
  readonly mermaidKinds: readonly string[];
  /** The library's reading time in minutes (its own rule, so the byline and the overlay's time left agree); absent when it gave none. */
  readonly readingMinutes?: number;
}

export type ReaderRenderOutcome =
  | {
      kind: 'rendered';
      result: { outcome: 'rendered'; html: string; meta: ReaderRenderMeta };
      mermaid: ScanRefsResult['mermaid'];
      images: readonly string[];
      imagesTruncated: boolean;
      /** Present only on a job with `print: true`: the allow-listed print tree of this very render's html. */
      printTree?: PrintTree;
    }
  | Extract<ParseOutcome, { kind: 'refused' }>
  | { kind: 'blocks'; blocks: readonly MdBlock[] }
  | { kind: 'not-rendered'; why: 'over-limit' | 'output-over-limit' | 'failed' }
  | Extract<ParseOutcome, { kind: 'threw' | 'timeout' | 'worker-unavailable' | 'worker-failed' }>;

/** The worker's answer to the job with the same `id`. */
export interface ReaderRenderReply {
  readonly id: number;
  readonly outcome: ReaderRenderOutcome;
}

/** The name of whatever was thrown: `name` for an error (a `DOMException` included), else its `typeof`. */
function errorName(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'name' in e && typeof e.name === 'string') return e.name;
  return typeof e;
}

/** The outcome of a blocks job for a source the pre-scan passed. May throw (the caller wraps it). */
function blocksOutcome(src: string): ReaderRenderOutcome {
  const rendered = render(src, { maxBytes: READER_BLOCKS_MAX_BYTES, maxHtmlBytes: READER_BLOCKS_HTML_MAX_BYTES, highlight: false });
  if (rendered.outcome !== 'rendered') return { kind: 'not-rendered', why: rendered.outcome };
  return { kind: 'blocks', blocks: renderedBlocks(parseRendered(rendered.html)) };
}

/** The outcome for one source. May throw (the caller wraps it). `print`: on a `rendered` answer, also the print tree of the
 *  same render's html (the allow-list over the parsed output); a `blocks` job ignores it. */
function renderOutcome(src: string, blocks: boolean, print: boolean): ReaderRenderOutcome {
  const scan = prescanMarkdown(src);
  if (!scan.ok) return { kind: 'refused', why: scan.why, line: scan.line, value: scan.value };
  if (blocks) return blocksOutcome(src);
  const rendered = render(src, { maxBytes: DOCS_RENDER_GATE_BYTES, maxHtmlBytes: READER_HTML_MAX_BYTES });
  if (rendered.outcome !== 'rendered') return { kind: 'not-rendered', why: rendered.outcome };
  const refs = scanRefs(src, { maxBytes: DOCS_RENDER_GATE_BYTES });
  const m = rendered.meta;
  return {
    kind: 'rendered',
    result: {
      outcome: 'rendered',
      html: rendered.html,
      meta: {
        title: m.title, frontList: m.frontList, headings: m.headings, figures: m.figures, mermaidKinds: m.mermaidKinds,
        ...(typeof m.readingMinutes === 'number' && Number.isFinite(m.readingMinutes) ? { readingMinutes: m.readingMinutes } : {}),
      },
    },
    mermaid: refs.mermaid,
    images: refs.images,
    imagesTruncated: refs.imagesTruncated,
    ...(print ? { printTree: printAllow(parseRendered(rendered.html)) } : {}),
  };
}

/** Everything the worker does with one render message (`markdownWorker.ts` is only the wiring), here so tests never
 *  import the worker entry. Never throws. */
export function answerRenderJob(data: unknown, post: (reply: ReaderRenderReply) => void): void {
  if (typeof data !== 'object' || data === null) return;
  const job = data as { readonly id?: unknown; readonly src?: unknown; readonly blocks?: unknown; readonly print?: unknown };
  const id = job.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) return;
  let outcome: ReaderRenderOutcome;
  try {
    outcome = typeof job.src === 'string' ? renderOutcome(job.src, job.blocks === true, job.print === true) : { kind: 'threw', error: 'TypeError' };
  } catch (e) {
    outcome = { kind: 'threw', error: errorName(e) };
  }
  try {
    post({ id, outcome });
  } catch (e) {
    try {
      post({ id, outcome: { kind: 'threw', error: errorName(e) } });
    } catch {
      // Nothing more can be said from here: the runner's budget timer answers this job.
    }
  }
}
