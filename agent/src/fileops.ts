import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ReadFailure } from '../../shared/agent-protocol.js';

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

/**
 * Raw fs behavior behind the read/readFrom/readB64/readdir/stat/writeB64
 * ops — intentionally mirrors `server/src/io.ts`'s `localIO` byte-for-byte
 * so a remote fleet behaves identically to a local one. Callers (server.ts)
 * are responsible for running paths through whitelist.checkPath first.
 *
 * `readWhole` mirrors `localIO`'s ERRNO BEHAVIOUR, not its TYPE: both sides
 * branch ENOENT vs. everything-else identically, but `readWhole` returns
 * `{data, absent}` here — a boolean, no `unreadable` distinction — while the
 * server-side equivalent, `MeasuredRead` in `server/src/io.ts`, is a
 * differently-shaped `{ok,reason}` union. That shape difference is still
 * deliberate and unconverged: `agent/tsconfig.json` includes only `src/**` +
 * `../shared/**`, so this side cannot import `server/src/io.ts` at all, and
 * `readWhole` predates `ReadFailure` (D-114) with no caller that needs the
 * finer distinction.
 *
 * The REASON VOCABULARY itself — `ReadFailure`, used below by
 * `readB64Measured`/`readFromMeasured` — is a different story: the plan that
 * introduced it (`docs/superpowers/plans/2026-08-20-fleetio-measured-
 * read.md`, "the seam's shape") kept it out of `shared/` on purpose, judging
 * the PWA's bundle path not worth it for a pair only this side and
 * `server/src/io.ts` used. That judgment was reversed (D-1438): the pair got
 * spelled out on both sides anyway and `single-definition.test.ts` caught
 * the drift, so it now lives once in `shared/agent-protocol.ts` as
 * `ReadFailure`, imported here rather than restated.
 */

/** `readWhole`'s result: `data` keeps the pre-existing null-for-any-failure
 *  meaning; `absent` is set true only when the failure was ENOENT (the file
 *  genuinely does not exist), so a caller that cares can distinguish that
 *  from EACCES/EISDIR/ELOOP/EIO/anything else — all of which mean the file
 *  IS there and this box just can't read it. Never-throw, same contract as
 *  every other op in this file.
 *
 *  SAME RESIDUAL AS THE SERVER'S `ReadFailure` (wave-1 review minor m2), and
 *  it must be stated on both sides because this is where the wire's own
 *  absent-marker is decided: a DANGLING SYMLINK is followed, the target's
 *  ENOENT is what `readFile` throws, and `absent` comes back true for a name
 *  that is still in the directory listing. Not closed with an `lstat` ladder
 *  here for the same reason as there — a second syscall on every field read
 *  to separate a state no ccd verb can produce. */
export type ReadResult = { data: string | null; absent: boolean };

export async function readWhole(p: string): Promise<ReadResult> {
  try {
    return { data: await readFile(p, 'utf8'), absent: false };
  } catch (e) {
    return { data: null, absent: (e as NodeJS.ErrnoException).code === 'ENOENT' };
  }
}

/** Same cap as the server's post-downscale upload ceiling (`MAX_UPLOAD_BYTES`
 *  in server/src/server.ts) — a clip round-trips through both, so neither
 *  side should accept what the other would reject. Exported so tests assert
 *  against THIS number rather than a second copy of it; it is a property of
 *  the WS round trip (one JSON frame carrying a base64 payload), not of the
 *  file, which is why `server/src/io.ts`'s `localIO` deliberately has no
 *  equivalent and why over-cap is REPORTED rather than folded into the
 *  same failure as missing (D-114, D-1401). */
export const MAX_READ_B64_BYTES = 12 * 1024 * 1024;

/** `readB64Measured`'s result. THREE failure facts where `readB64` had one
 *  null: a proven ENOENT, a file whose size exceeds the cap (carrying the
 *  measured `size`, so a caller can say what it refused and how big it was),
 *  and everything else. The wrapping `{ok,reason}` shape is local to this
 *  op (`too-large` has no equivalent on the server side); the two-word
 *  failure vocabulary it shares with `unreadable`/`absent` is `ReadFailure`,
 *  imported rather than restated (D-1438). */
export type ReadB64Result =
  | { ok: true; dataB64: string }
  | { ok: false; reason: ReadFailure }
  | { ok: false; reason: 'too-large'; size: number };

/** Binary-safe read: never decodes through a string, so bytes that aren't
 *  valid UTF-8 (e.g. a PNG header) survive byte-for-byte. Never throws, same
 *  contract as every other op in this file. */
export async function readB64Measured(p: string): Promise<ReadB64Result> {
  let size: number;
  try {
    size = (await stat(p)).size;
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
  if (size > MAX_READ_B64_BYTES) return { ok: false, reason: 'too-large', size };
  try {
    return { ok: true, dataB64: (await readFile(p)).toString('base64') };
  } catch (e) {
    // Unlinked between the stat and the read is a real race and a real
    // absence; anything else is not.
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
}

/** `readFromMeasured`'s result. The EOF arm is `ok`, NOT a failure: an offset
 *  at or past the file's size means "the cursor is at the end and there are
 *  no new bytes", which is a measurement, not a miss. */
export type ReadFromResult =
  | { ok: true; data: string; size: number }
  | { ok: false; reason: ReadFailure };

export async function readFromMeasured(p: string, offset: number): Promise<ReadFromResult> {
  // Stream only [offset, size) — never load the whole file. A transcript backlog
  // read of a tens-of-MB file used to slurp the whole thing here, ballooning the
  // agent's memory and stalling its event loop.
  let size: number;
  try {
    size = (await stat(p)).size;
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
  const from = Math.max(0, Math.min(offset, size));
  if (from >= size) return { ok: true, data: '', size };
  try {
    return { ok: true, data: (await readRange(p, from, size)).toString('utf8'), size };
  } catch (e) {
    return { ok: false, reason: (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'absent' : 'unreadable' };
  }
}

export async function listDir(p: string): Promise<string[] | null> {
  try { return await readdir(p); } catch { return null; }
}

/** `statMeasured`'s result — the `stat` op's half of `ReadResult` above, and
 *  a LOCAL type for the same reason (this side cannot import
 *  `server/src/io.ts`, and the reason union stays out of `shared/` because
 *  that is the PWA's bundle path).
 *
 *  `absent` is true ONLY on a proven ENOENT. Every other errno — EACCES,
 *  ENOTDIR, ELOOP, EIO — and every non-errno throw leaves it false, meaning
 *  "this path may well be there and this box could not measure it". Before
 *  this type, all of them left through `server.ts`'s `?? { missing: true }`
 *  wearing the wire's proven-absence marker (D-114); this type is what
 *  closes it (D-1396), read in exactly one place, this function.
 *
 *  SAME DANGLING-SYMLINK RESIDUAL as `ReadResult`, and it must be stated here
 *  too: `stat` follows the link, the TARGET's ENOENT is what throws, and
 *  `absent` comes back true for a name still in its directory listing. Not
 *  closed with an `lstat` ladder, for the reason recorded there. */
export type StatResult =
  | { ok: true; mtimeMs: number; size: number }
  | { ok: false; absent: boolean };

export async function statMeasured(p: string): Promise<StatResult> {
  try {
    const s = await stat(p);
    return { ok: true, mtimeMs: s.mtimeMs, size: s.size };
  } catch (e) {
    return { ok: false, absent: (e as NodeJS.ErrnoException).code === 'ENOENT' };
  }
}

export type WriteResult = { ok: true } | { ok: false; err: string };

/**
 * Never throws: any fs error (ENOTDIR from a path collision, ENOSPC,
 * EACCES, …) is caught and reported in the return value instead of becoming
 * an unhandled rejection in the caller's fire-and-forget dispatch, which
 * would otherwise crash the whole ccrc-agent process.
 */
export async function writeB64(p: string, dataB64: string): Promise<WriteResult> {
  try {
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, Buffer.from(dataB64, 'base64'));
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : 'write-failed' };
  }
}
