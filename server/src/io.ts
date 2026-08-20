import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Why a read couldn't produce content: `absent` means the path genuinely
 *  does not exist (ENOENT); `unreadable` means everything else — EACCES,
 *  EISDIR, ENOTDIR, ELOOP, a non-errno failure — the path IS there (or the
 *  box can't even tell) and this box just can't read it. Fail-shut on
 *  purpose: only a proven ENOENT is allowed to answer `absent`. */
export type ReadFailure = 'absent' | 'unreadable';

/** A read that distinguishes ITS OWN two failure modes instead of collapsing
 *  both to `null`, unlike `readFile`/`readFileB64` below. See THE GOVERNING
 *  RULE in `docs/superpowers/plans/2026-08-20-fleetio-measured-read.md`
 *  (committed, not the session-scoped SDD scratch dir): the measured read is
 *  ADDITIONAL evidence, never a replacement for existing evidence — at every
 *  migrated call site, `ok:true`/`reason:'absent'` are POSITIVE answers that
 *  short-circuit, while `reason:'unreadable'` must fall back to exactly the
 *  evidence that site already used before this type existed, never replace
 *  it outright. */
export type MeasuredRead = { ok: true; content: string } | { ok: false; reason: ReadFailure };

/**
 * Fs-facade seam every fleet-fs access goes through. `local` (this module)
 * hits node:fs against this box's disk; a `remote` implementation (T3) proxies
 * the same ops over the agent WS to a REMOTE fleet host — no other module may
 * import node:fs directly for fleet paths once threaded through this.
 */
export interface FleetIO {
  /** Distinguishes "genuinely does not exist" from "exists but unreadable" —
   *  see `MeasuredRead`/`ReadFailure` above. `readFile` derives from this. */
  readFileMeasured(path: string): Promise<MeasuredRead>;
  readFile(path: string): Promise<string | null>;   // null on ANY failure — absent and unreadable both collapse here; use readFileMeasured to tell them apart
  readFileFrom(path: string, offset: number): Promise<{ data: string; size: number } | null>;
  readFileB64(path: string): Promise<string | null>;      // null on missing or unreadable; the agent's implementation folds in a THIRD condition, over-cap (D-114, agent/src/fileops.ts's MAX_READ_B64_BYTES) — localIO has no cap — binary-safe
  readdir(path: string): Promise<string[] | null>;
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>;
  /** Physical path for `path`, or null when it cannot be resolved (missing
   *  path, permission, or an implementation with no resolver — the remote io
   *  answers null unconditionally, so callers degrade to the unresolved
   *  path). Exists for transcript resolution: Claude Code munges its PHYSICAL
   *  cwd, the registry keeps the path ccd wrote, and on a symlinked projects
   *  root the two disagree. */
  realpath(path: string): Promise<string | null>;
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
  async readFileMeasured(p) {
    try {
      return { ok: true, content: await readFile(p, 'utf8') };
    } catch (err) {
      const reason: ReadFailure = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable';
      return { ok: false, reason };
    }
  },

  async readFile(p) {
    const r = await this.readFileMeasured(p);
    return r.ok ? r.content : null;
  },

  async readFileFrom(p, offset) {
    // Stream only [offset, size) — never load the whole file. Transcripts reach
    // tens of MB; the old read-whole-then-slice bloated the agent's RSS and
    // blocked its event loop (base64 + JSON.stringify of the full buffer).
    let size: number;
    try { size = (await stat(p)).size; } catch { return null; }
    const from = Math.max(0, Math.min(offset, size));
    if (from >= size) return { data: '', size };
    try { return { data: (await readRange(p, from, size)).toString('utf8'), size }; }
    catch { return null; }
  },

  async readFileB64(p) {
    try { return (await readFile(p)).toString('base64'); } catch { return null; }
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

  async realpath(p) {
    try { return await realpath(p); } catch { return null; }
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
