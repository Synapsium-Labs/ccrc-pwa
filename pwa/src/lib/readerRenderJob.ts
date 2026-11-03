// The reader's render job, worker side (native Docs reader, W8a Task 4; the rich-docs spec's (amended 2026-10-31) A6 and
// M8.21, base design section 4.10's worker and timeout outcome). Ring L1: it makes no I/O, and it imports only
// `readerLimits`, `markdownLimits`, `markdownGuard`, types from `markdownParse`, and the shared Markdown library's
// renderer entry (the one import of that library in `pwa/src/lib`). It is the worker's LAZY chunk: `markdownWorker.ts`
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
import { render, scanRefs, type FrontEntry, type Heading, type ScanRefsResult } from '@synapsium-labs/docserver/render';
import { prescanMarkdown } from './markdownGuard';
import { DOCS_RENDER_GATE_BYTES } from './markdownLimits';
import type { ParseOutcome } from './markdownParse';
import { READER_HTML_MAX_BYTES } from './readerLimits';

/** One render job for the worker, as the runner posts it. */
export interface ReaderRenderJob {
  readonly id: number;
  readonly kind: 'render';
  readonly src: string;
}

/** The page's facts the reader draws from: the library's meta fields it uses. */
export interface ReaderRenderMeta {
  readonly title: string | null;
  readonly frontList: readonly FrontEntry[] | null;
  readonly headings: readonly Heading[];
  readonly figures: number;
  readonly mermaidKinds: readonly string[];
}

export type ReaderRenderOutcome =
  | {
      kind: 'rendered';
      result: { outcome: 'rendered'; html: string; meta: ReaderRenderMeta };
      mermaid: ScanRefsResult['mermaid'];
      images: readonly string[];
      imagesTruncated: boolean;
    }
  | Extract<ParseOutcome, { kind: 'refused' }>
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

/** The outcome for one source. May throw (the caller wraps it). */
function renderOutcome(src: string): ReaderRenderOutcome {
  const scan = prescanMarkdown(src);
  if (!scan.ok) return { kind: 'refused', why: scan.why, line: scan.line, value: scan.value };
  const rendered = render(src, { maxBytes: DOCS_RENDER_GATE_BYTES, maxHtmlBytes: READER_HTML_MAX_BYTES });
  if (rendered.outcome !== 'rendered') return { kind: 'not-rendered', why: rendered.outcome };
  const refs = scanRefs(src, { maxBytes: DOCS_RENDER_GATE_BYTES });
  const m = rendered.meta;
  return {
    kind: 'rendered',
    result: {
      outcome: 'rendered',
      html: rendered.html,
      meta: { title: m.title, frontList: m.frontList, headings: m.headings, figures: m.figures, mermaidKinds: m.mermaidKinds },
    },
    mermaid: refs.mermaid,
    images: refs.images,
    imagesTruncated: refs.imagesTruncated,
  };
}

/** Everything the worker does with one render message (`markdownWorker.ts` is only the wiring), here so tests never
 *  import the worker entry. Never throws. */
export function answerRenderJob(data: unknown, post: (reply: ReaderRenderReply) => void): void {
  if (typeof data !== 'object' || data === null) return;
  const job = data as { readonly id?: unknown; readonly src?: unknown };
  const id = job.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) return;
  let outcome: ReaderRenderOutcome;
  try {
    outcome = typeof job.src === 'string' ? renderOutcome(job.src) : { kind: 'threw', error: 'TypeError' };
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
