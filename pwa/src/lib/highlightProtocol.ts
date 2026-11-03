// The highlight worker's wire and a highlighter's face (native Docs reader, W5h-a Task 2; base spec 2026-10-01
// section 4.10 "The job and its outcome"). Types only, importing nothing: the worker side (`highlightJob.ts`,
// `markdownHighlightWorker.ts`) and the main thread (`markdownRunner.ts`, `highlightStore.ts`) both name them, and
// neither may import the other (the W5h-a plan's refinement (b)). `HighlightOutcome` is its own union, so
// `ParseOutcome` keeps its eight arms (M4.H10).
//
// Ring L2: declarations only.

/** One job is one block. `mode` absent: the whole block; `'line'`: the retry under C24. */
export interface HighlightJob {
  readonly id: number;
  readonly lang: string;
  readonly code: string;
  readonly mode?: 'line';
}

/** What the worker answers one job. `html` says which mode produced it. */
export type HighlightResult =
  | { readonly kind: 'html'; readonly html: string; readonly mode: 'block' | 'line' }
  | { readonly kind: 'unregistered' }
  /** Over MD_HIGHLIGHT_MAX_HTML_CHARS: refused before posting. */
  | { readonly kind: 'too-large'; readonly htmlChars: number }
  /** Line mode only: one line over HIGHLIGHT_LINE_RETRY_UNITS. */
  | { readonly kind: 'line-too-long'; readonly chars: number }
  /** `error.name` only. */
  | { readonly kind: 'threw'; readonly error: string };

/** What the worker posts: `{ready: true}` once its module has evaluated, then one reply per job. */
export type HighlightReply = { readonly ready: true } | { readonly id: number; readonly result: HighlightResult };

/** A job's outcome on the main thread: the worker's result, or one of the runner's own three arms. */
export type HighlightOutcome =
  | HighlightResult
  /** HIGHLIGHT_BLOCK_DEADLINE_MS passed after the post. */
  | { readonly kind: 'timeout'; readonly budgetMs: number }
  | { readonly kind: 'worker-unavailable' }
  /** A worker error, a failed post, or a boot past HIGHLIGHT_BOOT_BUDGET_MS. */
  | { readonly kind: 'worker-failed'; readonly error: string };

/** What a store asks a highlighter to colour. */
export interface HighlightRequest {
  readonly lang: string;
  readonly code: string;
  readonly mode?: 'line';
}

/** Whether a highlighter can take a job now: `live` (a worker is up or booting), `worker-unavailable` (spawning
 *  threw: no `Worker` here, for good), `worker-failed` (two boots failed in a row: sticky until the app reloads). */
export type HighlighterStatus = 'live' | 'worker-unavailable' | 'worker-failed';

/** A highlight runner as a store sees it. `onPosted` runs when the job is posted to the worker (after the ready
 *  handshake, after any job ahead of it), never for a job that is not posted. The promise rejects only on an
 *  abort: an aborted running job is detached (its answer is dropped, the worker lives on). */
export interface Highlighter {
  highlight(
    request: HighlightRequest,
    opts: { readonly signal?: AbortSignal; readonly onPosted?: () => void },
  ): Promise<HighlightOutcome>;
  /** Spawns the worker when none is live, then answers whether a job can be taken. */
  status(): HighlighterStatus;
  /** Spawns the worker now, when there is none, so the first block does not wait for its boot. */
  prewarm(): void;
}
