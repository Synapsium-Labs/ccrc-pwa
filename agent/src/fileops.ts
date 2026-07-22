import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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
 * Raw fs behavior behind the read/readFrom/readdir/stat/writeB64 ops —
 * intentionally mirrors `server/src/io.ts`'s `localIO` byte-for-byte so a
 * remote fleet behaves identically to a local one. Callers (server.ts) are
 * responsible for running paths through whitelist.checkPath first.
 */

export async function readWhole(p: string): Promise<string | null> {
  try { return await readFile(p, 'utf8'); } catch { return null; }
}

export async function readFrom(p: string, offset: number): Promise<{ data: string; size: number } | null> {
  // Stream only [offset, size) — never load the whole file. A transcript backlog
  // read of a tens-of-MB file used to slurp the whole thing here, ballooning the
  // agent's memory and stalling its event loop.
  let size: number;
  try { size = (await stat(p)).size; } catch { return null; }
  const from = Math.max(0, Math.min(offset, size));
  if (from >= size) return { data: '', size };
  try { return { data: (await readRange(p, from, size)).toString('utf8'), size }; }
  catch { return null; }
}

export async function listDir(p: string): Promise<string[] | null> {
  try { return await readdir(p); } catch { return null; }
}

export async function statPath(p: string): Promise<{ mtimeMs: number; size: number } | null> {
  try {
    const s = await stat(p);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch { return null; }
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
