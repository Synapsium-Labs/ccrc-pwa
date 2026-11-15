// ccd/history/overlord-worker.mjs — the worker thread's entry for the agent's `overlord-history` op (Overlord W1, plan
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md, Task 3; ruled F2, R5).
//
// The agent runs this file with `new Worker(path, { workerData, env: {} })`, so the read's synchronous SQLite never
// blocks the agent's link. It imports overlord-read.mjs statically (no dynamic import), reads one request from
// workerData, posts the one answer, and keeps no listener after it, so the thread exits. It reads no environment.
import { parentPort, workerData } from 'node:worker_threads';
import { overlordRead } from './overlord-read.mjs';

if (parentPort !== null) {
  const answer = await overlordRead(workerData.home, workerData.request, workerData.nowMs);
  parentPort.postMessage(answer);
}
