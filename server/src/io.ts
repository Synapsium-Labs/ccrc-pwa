import { createReadStream, watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Why a read couldn't produce content — and, since `MeasuredStat` below,
 *  why a `stat` couldn't produce {mtimeMs,size} either: ONE vocabulary for
 *  both, because they are the same two facts. `absent` means the path
 *  genuinely does not exist (ENOENT); `unreadable` means everything else — EACCES,
 *  EISDIR, ENOTDIR, ELOOP, a non-errno failure — the path IS there (or the
 *  box can't even tell) and this box just can't read it. Fail-shut on
 *  purpose: only a proven ENOENT is allowed to answer `absent`.
 *
 *  ONE RESIDUAL, stated rather than closed (wave-1 review minor m2): a
 *  DANGLING SYMLINK answers `absent`. `readFile` follows the link, the
 *  TARGET is missing, and the errno is ENOENT — so a name that IS in the
 *  registry listing reads measured-absent, which is the one crack in
 *  D-112's "a proven ENOENT can only come from a purge". No ccd verb
 *  writes a symlink into `$REG`, so the state is reachable only by hand,
 *  and the direction is the safe one for every current consumer (a hold
 *  reads released, an identity field retires the row). An `lstat` ladder
 *  would close it and is deliberately NOT built: it would put a second
 *  syscall on every field read of every session on every tick to
 *  distinguish a state nothing in this system produces. */
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

/** A `stat` that distinguishes its own two failure modes instead of
 *  collapsing both to `null`, exactly as `MeasuredRead` does for reads — and
 *  for a sharper reason: the agent's `stat` op used to answer EACCES/ENOTDIR
 *  as `{missing:true}`, so the wire's absence marker was already a LIE for
 *  every non-ENOENT failure (D-114). `stat` derives from this. THE GOVERNING
 *  RULE applies unchanged: `ok`/`absent` are positive answers that
 *  short-circuit, `unreadable` falls back to exactly the evidence the site
 *  already used. */
export type MeasuredStat =
  | { ok: true; mtimeMs: number; size: number }
  | { ok: false; reason: ReadFailure };

/** A binary read that distinguishes its THREE failure modes. `too-large` is
 *  not a fault and not an absence: the file is there and this transport
 *  cannot carry it (the agent's `MAX_READ_B64_BYTES`, a property of the WS
 *  frame). `localIO` has no cap and therefore never answers it — the
 *  divergence is REPORTED at the seam rather than equalised, because capping
 *  `localIO` would start refusing clips this server serves today. `size` is
 *  `number | null`: null when the marker arrived without one, never a
 *  manufactured 0. */
export type MeasuredB64Read =
  | { ok: true; dataB64: string }
  | { ok: false; reason: ReadFailure }
  | { ok: false; reason: 'too-large'; size: number | null };

/** A range read that distinguishes its two failure modes. The EOF answer —
 *  `{ok: true, data: '', size}` — is a MEASUREMENT (the cursor is at the end)
 *  and never joins them. */
export type MeasuredRangeRead =
  | { ok: true; data: string; size: number }
  | { ok: false; reason: ReadFailure };

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
  /** Distinguishes absence from unreadability for a range read; the EOF arm
   *  is a positive answer. `readFileFrom` derives from this. */
  readFileFromMeasured(path: string, offset: number): Promise<MeasuredRangeRead>;
  readFileFrom(path: string, offset: number): Promise<{ data: string; size: number } | null>;   // null on ANY failure; use readFileFromMeasured to tell absent from unreadable
  /** Distinguishes absence, unreadability and over-cap. `readFileB64` derives
   *  from this. */
  readFileB64Measured(path: string): Promise<MeasuredB64Read>;
  readFileB64(path: string): Promise<string | null>;      // null on ANY failure — the agent's half folds a THIRD condition in here, over-cap (agent/src/fileops.ts's MAX_READ_B64_BYTES); localIO has no cap — binary-safe
  readdir(path: string): Promise<string[] | null>;
  /** Distinguishes "genuinely does not exist" from "could not be measured".
   *  `stat` derives from this; see `MeasuredStat` above for why the wire's
   *  own absence marker could not be trusted before this existed. */
  statMeasured(path: string): Promise<MeasuredStat>;
  stat(path: string): Promise<{ mtimeMs: number; size: number } | null>;   // null on ANY failure — absent and unreadable both collapse here; use statMeasured to tell them apart
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

/** The ONE place an errno becomes a `ReadFailure`. Only a proven ENOENT may
 *  answer `absent`; every other errno — and a non-errno throw, which carries
 *  no `code` at all — is `unreadable`. */
const failureFor = (err: unknown): ReadFailure =>
  (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable';

/** node:fs implementation preserving today's exact behavior. */
export const localIO: FleetIO = {
  async readFileMeasured(p) {
    try {
      return { ok: true, content: await readFile(p, 'utf8') };
    } catch (err) {
      return { ok: false, reason: failureFor(err) };
    }
  },

  async readFile(p) {
    const r = await this.readFileMeasured(p);
    return r.ok ? r.content : null;
  },

  async readFileFromMeasured(p, offset) {
    // Stream only [offset, size) — never load the whole file. Transcripts reach
    // tens of MB; the old read-whole-then-slice bloated the agent's RSS and
    // blocked its event loop (base64 + JSON.stringify of the full buffer).
    let size: number;
    try { size = (await stat(p)).size; } catch (err) { return { ok: false, reason: failureFor(err) }; }
    const from = Math.max(0, Math.min(offset, size));
    if (from >= size) return { ok: true, data: '', size };
    try { return { ok: true, data: (await readRange(p, from, size)).toString('utf8'), size }; }
    catch (err) { return { ok: false, reason: failureFor(err) }; }
  },

  async readFileFrom(p, offset) {
    const r = await this.readFileFromMeasured(p, offset);
    return r.ok ? { data: r.data, size: r.size } : null;
  },

  async readFileB64Measured(p) {
    try { return { ok: true, dataB64: (await readFile(p)).toString('base64') }; }
    catch (err) { return { ok: false, reason: failureFor(err) }; }
  },

  async readFileB64(p) {
    const r = await this.readFileB64Measured(p);
    return r.ok ? r.dataB64 : null;
  },

  async readdir(p) {
    try { return await readdir(p); } catch { return null; }
  },

  async statMeasured(p) {
    try {
      const s = await stat(p);
      return { ok: true, mtimeMs: s.mtimeMs, size: s.size };
    } catch (err) {
      return { ok: false, reason: failureFor(err) };
    }
  },

  async stat(p) {
    const r = await this.statMeasured(p);
    return r.ok ? { mtimeMs: r.mtimeMs, size: r.size } : null;
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
