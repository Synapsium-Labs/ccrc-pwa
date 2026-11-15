/**
 * The `overlord-history` op (Overlord W1, plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`,
 * Task 3; spec 2026-11-09 §3.2, C47; the coordinator's rulings F2, F5 and R5).
 *
 * It runs `ccd/history/overlord-worker.mjs` in a `node:worker_threads` worker inside the agent's process, so a long
 * synchronous SQLite read never stalls the one link to the server. That is still in-process: no shell, no CLI and no new
 * spawn class. The worker is started with `env: {}` (the agent's environment carries its token) and both output streams
 * piped and drained from construction (an unread stream of 64 KiB or more stops a worker from ever exiting).
 *
 * - ONE slot per agent process. It frees only on the worker's `exit` event, never at `terminate()`: a worker inside one
 *   long native statement cannot be interrupted, and `terminate()` takes effect only when the statement returns. While
 *   it is held, a request answers `busy`.
 * - At the deadline the op answers `deadline` and calls `terminate()`; an answer posted after it is dropped.
 * - A worker `error` or `messageerror` event, an `exit` with no answer, a constructor that throws and any other throw
 *   answer `failed` (`internal`). `error.message` is never read, logged or forwarded: it carries the thrown text
 *   verbatim. The op logs one fixed line.
 * - Every answer is an `OverlordHistoryAnswer`, always on `ResOk`; the posted answer passes its one reader here too, and
 *   one over `OVERLORD_HISTORY_ANSWER_MAX_BYTES` answers `too-large` with its size.
 *
 * The resolver finds the worker's entry from this file's own location, in both layouts: two directories up from
 * `agent/src` in source, four up from the compiled `agent/dist/agent/src` in a release. It answers an absolute path or
 * null; the resolver, the deadline and the platform are injected in tests.
 */
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OVERLORD_HISTORY_ANSWER_MAX_BYTES, readOverlordHistoryAnswer, type OverlordHistoryAnswer, type OverlordHistoryRequest,
} from '../../shared/overlordHistory.js';

/** The op's deadline. Below the server's request timeout for this op (25 s, PR B1), which is below `ccrc-api`'s
 *  `curl -m 30` (R10); above the read's SQLite busy timeout (`overlord-read.mjs#OVERLORD_READ_BUSY_TIMEOUT_MS`). */
export const OVERLORD_HISTORY_DEADLINE_MS = 20_000;

const WORKER_REL = ['ccd', 'history', 'overlord-worker.mjs'] as const;

/** The worker's entry from `here` (this module's own path): two directories up in source, four up in a release. */
export function resolveOverlordWorker(here: string = fileURLToPath(import.meta.url)): string | null {
  const dir = path.dirname(here);
  for (const up of [2, 4]) {
    const p = path.resolve(dir, ...Array.from({ length: up }, () => '..'), ...WORKER_REL);
    if (existsSync(p)) return p;
  }
  return null;
}

export interface HistoryOpSeams {
  /** The worker entry's absolute path, or null when this install carries none. */
  resolveWorker: () => string | null;
  deadlineMs: number;
  /** The platform the `ready` frame's check reads (Task 4). */
  platform: NodeJS.Platform;
  /** One fixed line per failure; never a message. */
  log: (line: string) => void;
}

export const realHistoryOpSeams = (): HistoryOpSeams => ({
  resolveWorker: () => resolveOverlordWorker(),
  deadlineMs: OVERLORD_HISTORY_DEADLINE_MS,
  platform: process.platform,
  log: (line) => { console.warn(line); },
});

export interface HistoryOp {
  /** Whether this agent can serve the history store, decided once at boot (Task 4, F20): the worker's entry is found and
   *  the platform is not macOS. The `ready` frame lists `overlord-history` only then. No role is read (R1): an agent runs
   *  only on a `fleet` or `both` box. The store's own state, absent or unreadable, is the op's answer, never a reason to
   *  withhold the word. */
  readonly servable: boolean;
  /** One read for `owner` (the connection that asked). Never rejects. */
  run(home: string, request: OverlordHistoryRequest, owner: object): Promise<OverlordHistoryAnswer>;
  /** The link `owner` closed: its read's worker is terminated; the slot still frees only on the worker's exit. */
  abandon(owner: object): void;
}

const FAILED: OverlordHistoryAnswer = { outcome: 'failed', word: 'internal' };
const FAILED_LINE = 'ccrc-agent: overlord-history failed';
const drain = (): void => {};

/** The answer a posted message stands for: too large, off-shape (a failure), or the typed outcome. */
function answerOf(m: unknown): OverlordHistoryAnswer | null {
  let bytes: number;
  try { bytes = Buffer.byteLength(JSON.stringify(m) ?? '', 'utf8'); } catch { return null; }
  if (bytes > OVERLORD_HISTORY_ANSWER_MAX_BYTES) return { outcome: 'too-large', bytes };
  const a = readOverlordHistoryAnswer(m);
  return a === 'off-shape' ? null : a;
}

/** The op, with its one slot. One per agent process, shared by every connection. */
export function createHistoryOp(seams: HistoryOpSeams): HistoryOp {
  let slot: { owner: object; worker: Worker } | null = null;

  const failed = (): OverlordHistoryAnswer => { seams.log(FAILED_LINE); return FAILED; };

  function start(home: string, request: OverlordHistoryRequest, owner: object): Promise<OverlordHistoryAnswer> {
    if (slot !== null) return Promise.resolve({ outcome: 'busy' });
    const entry = seams.resolveWorker();
    if (entry === null) return Promise.resolve(failed());
    let worker: Worker;
    try {
      worker = new Worker(entry, {
        workerData: { home, request: { verb: request.verb, target: request.target, agents: request.agents, args: [...request.args] }, nowMs: Date.now() },
        env: {}, stdout: true, stderr: true,
      });
    } catch {
      // A bad path throws at once (ERR_WORKER_PATH) and no exit ever fires: the slot was never taken.
      return Promise.resolve(failed());
    }
    const held = { owner, worker };
    slot = held;
    worker.stdout.on('data', drain);
    worker.stderr.on('data', drain);
    return new Promise((resolve) => {
      let settled = false;
      const settle = (a: OverlordHistoryAnswer): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(a);
        worker.terminate().catch(drain);
      };
      const timer = setTimeout(() => { settle({ outcome: 'deadline' }); }, seams.deadlineMs);
      worker.on('message', (m: unknown) => {
        if (settled) return;   // a late answer, after the deadline: dropped
        const a = answerOf(m);
        settle(a ?? failed());
      });
      worker.on('error', () => { if (!settled) settle(failed()); });
      worker.on('messageerror', () => { if (!settled) settle(failed()); });
      worker.on('exit', () => {
        if (slot === held) slot = null;
        if (!settled) settle(failed());
      });
    });
  }

  return {
    servable: seams.platform !== 'darwin' && seams.resolveWorker() !== null,
    async run(home, request, owner) {
      try {
        return await start(home, request, owner);
      } catch {
        return failed();
      }
    },
    abandon(owner) {
      if (slot !== null && slot.owner === owner) slot.worker.terminate().catch(drain);
    },
  };
}
