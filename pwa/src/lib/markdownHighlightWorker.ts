// The highlight worker's entry (native Docs reader, W5h-a Task 3; base spec 2026-10-01 section 4.10 "Highlighting":
// its Files table and the ready handshake). `markdownRunner.ts#spawnHighlightWorker` spawns it as a module worker;
// Vite emits it as a second worker chunk, which the service worker precaches with the shell (M7.11,
// `markdown-worker-built.test.ts`). It is only the wiring: once its imports have evaluated (the 15 grammars
// registered on the private instance) it assigns `onmessage`, then posts `{ready: true}` once; each message goes to
// `highlightJob.ts`'s answerer, whose reply is posted back. Messages are received by ASSIGNING `onmessage`, never by
// adding a listener (M4.H3's message clause, `markdown-runner.test.ts`). The PWA's tsconfig has no WebWorker lib, so
// the worker global is typed here by what is used of it.
//
// Ring L4: the worker's delivery. Its closure is `markdown-purity.test.ts`'s M4.H3 describe.
import { createHighlightAnswerer } from './highlightJob';
import type { HighlightReply } from './highlightProtocol';

const worker = self as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null;
  postMessage(reply: HighlightReply): void;
};

const answer = createHighlightAnswerer();
worker.onmessage = (e) => answer(e.data, (reply) => worker.postMessage(reply));
worker.postMessage({ ready: true });
