// The parse worker's entry (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker and runner").
// `markdownRunner.ts` spawns it as a module worker; Vite emits it as its own ES module chunk (the `worker` key of
// `vite.config.ts` sets that format and the worker-only plugin), which the service worker precaches with the rest of
// the shell. It is only the wiring: each message goes to
// `answerMarkdownJob` (`markdownParse.ts`), whose answer is posted back to the runner. Messages are received by
// assigning `onmessage`, never by adding a listener (the W4 plan's refinement (w)). One kind of message goes
// elsewhere: a `kind: 'render'` job (the reader's, W8a Task 4) is answered by `readerRenderJob.ts`, loaded on the first
// such message through ONE literal `import()` and held in a module-level promise, so the parse chunk carries none of
// the renderer (`markdown-purity.test.ts` and `markdown-worker-built.test.ts` pin it).
//
// Its first-party import closure is the parse's own (`markdown-purity.test.ts`), and the built chunk loads with no
// DOM (`markdown-worker-built.test.ts`, with `vite.config.ts`'s worker-only resolution). The PWA's tsconfig has no
// WebWorker lib (it conflicts with DOM), so the worker global is typed here by what is used of it.
import { answerMarkdownJob, type MarkdownReply } from './markdownParse';

const worker = self as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(reply: MarkdownReply | import('./readerRenderJob').ReaderRenderReply): void;
};

/** The render job's chunk, imported once on the first render message. A rejected import posts nothing: the runner's
 *  budget answers that job `timeout`. */
let renderJob: Promise<typeof import('./readerRenderJob')> | undefined;

worker.onmessage = (e) => {
  const d = e.data as { kind?: unknown } | null;
  if (typeof d === 'object' && d !== null && d.kind === 'render') {
    (renderJob ??= import('./readerRenderJob')).then(
      (m) => m.answerRenderJob(e.data, (r) => worker.postMessage(r)),
      () => undefined,
    );
    return;
  }
  answerMarkdownJob(e.data, (reply) => worker.postMessage(reply));
};
