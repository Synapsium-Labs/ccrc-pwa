import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Fs-facade seam every fleet-fs access goes through. `local` (this module)
 * hits node:fs against this box's disk; a `remote` implementation (T3) proxies
 * the same ops over the agent WS to a REMOTE fleet host — no other module may
 * import node:fs directly for fleet paths once threaded through this.
 */
export interface FleetIO {
  readFile(path: string): Promise<string | null>;                      // null = missing
  readFileFrom(path: string, offset: number): Promise<{ data: string; size: number } | null>;
  readdir(path: string): Promise<string[] | null>;
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>;
  writeFileB64(path: string, dataB64: string): Promise<void>;          // mkdir -p parent
  tailFile(
    path: string,
    offset: number,
    onData: (chunk: Buffer) => void,
    onReset: (size: number) => void,
  ): Promise<() => void>; // returns close()
}

/** Read byte range [start, end) of `file` (createReadStream `end` is inclusive). */
function readRange(file: string, start: number, end: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    createReadStream(file, { start, end: end - 1 })
      .on('data', (c) => chunks.push(c as Buffer))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

const TAIL_POLL_MS = 1500;

/** node:fs implementation preserving today's exact behavior. */
export const localIO: FleetIO = {
  async readFile(p) {
    try { return await readFile(p, 'utf8'); } catch { return null; }
  },

  async readFileFrom(p, offset) {
    let buf: Buffer;
    try { buf = await readFile(p); } catch { return null; }
    const size = buf.byteLength;
    const from = Math.max(0, Math.min(offset, size));
    return { data: buf.subarray(from).toString('utf8'), size };
  },

  async readdir(p) {
    try { return await readdir(p); } catch { return null; }
  },

  async stat(p) {
    try {
      const s = await stat(p);
      return { mtimeMs: s.mtimeMs, size: s.size };
    } catch { return null; }
  },

  async writeFileB64(p, dataB64) {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, Buffer.from(dataB64, 'base64'));
  },

  /**
   * Mirrors the transcript tailer's original mechanics: fs.watch on the file's
   * directory (rename-safe) plus a poll fallback; a single in-flight read loop
   * (re-triggered watch/poll events during a read just re-run it once more).
   * Reset (file shrank under us — truncation/rotation) stops the internal
   * watch/poll before calling `onReset`; the returned close() is idempotent.
   */
  async tailFile(filePath, fromOffset, onData, onReset) {
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

    return () => {
      stopped = true;
      stopWatching();
    };
  },
};
