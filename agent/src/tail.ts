import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * tailOpen/tailClose backing implementation — mirrors `server/src/io.ts`'s
 * `localIO.tailFile` mechanics (fs.watch on the directory + poll fallback,
 * single in-flight read loop, reset on shrink) but returns a handle
 * synchronously so server.ts can register it under a tailId before any
 * data/reset event can fire.
 */
export interface TailHandle { close(): void }

const TAIL_POLL_MS = 1500;

function readRange(file: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(file, { start, end: end - 1 })
      .on('data', (c) => chunks.push(c as Buffer))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

export function openTail(
  filePath: string,
  fromOffset: number,
  onData: (chunk: Buffer) => void,
  onReset: (size: number) => void,
): TailHandle {
  let offset = fromOffset;
  let watcher: FSWatcher | null = null;
  let poll: NodeJS.Timeout | null = null;
  let inFlight = false;
  let pending = false;
  let stopped = false;

  const stopWatching = (): void => {
    watcher?.close();
    watcher = null;
    if (poll) clearInterval(poll);
    poll = null;
  };

  const readOnce = async (): Promise<void> => {
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      return; // file missing (not created yet) — keep waiting
    }
    if (size < offset) {
      stopped = true;
      stopWatching();
      onReset(size);
      return;
    }
    if (size === offset) return;
    let chunk: Buffer;
    try {
      chunk = await readRange(filePath, offset, size);
    } catch {
      return; // transient read failure — retry on next trigger
    }
    offset = size;
    if (!stopped) onData(chunk);
  };

  const loop = async (): Promise<void> => {
    inFlight = true;
    try {
      do {
        pending = false;
        await readOnce();
      } while (pending && !stopped);
    } finally {
      inFlight = false;
    }
  };

  const trigger = (): void => {
    if (stopped) return;
    if (inFlight) { pending = true; return; }
    void loop();
  };

  try {
    watcher = watch(path.dirname(filePath), (_event, filename) => {
      if (!filename || filename.toString() === path.basename(filePath)) trigger();
    });
  } catch {
    // directory may not exist yet — the poll fallback keeps checking
  }
  poll = setInterval(trigger, TAIL_POLL_MS);
  trigger();

  return {
    close: () => {
      stopped = true;
      stopWatching();
    },
  };
}
