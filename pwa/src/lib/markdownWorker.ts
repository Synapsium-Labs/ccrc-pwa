// The parse worker's entry (native Docs reader, W4 Task 5; design 2026-10-01 section 4.10's "Worker and runner").
// `markdownRunner.ts` spawns it as a module worker; Vite emits it as its own chunk (`worker: { format: 'es' }`), which
// the service worker precaches with the rest of the shell. It is only the wiring: each message goes to
// `answerMarkdownJob` (`markdownParse.ts`), whose answer is posted back to the runner. Messages are received by
// assigning `onmessage`, never by adding a listener (the W4 plan's refinement (w)).
//
// Its first-party import closure is the parse's own (`markdown-purity.test.ts`), and the built chunk loads with no
// DOM (`markdown-worker-built.test.ts`, with `vite.config.ts`'s worker-only resolution). The PWA's tsconfig has no
// WebWorker lib (it conflicts with DOM), so the worker global is typed here by what is used of it.
import { answerMarkdownJob, type MarkdownReply } from './markdownParse';

const worker = self as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(reply: MarkdownReply): void;
};

worker.onmessage = (e) => answerMarkdownJob(e.data, (reply) => worker.postMessage(reply));
