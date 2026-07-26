import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { StagedClip } from '../../shared/api.js';
import type { CcrcConfig } from './config.js';
import type { FleetIO } from './io.js';

/** A session id safe to use as a single path component. Exported because the
 *  upload and clip routes gate on the same rule before any filesystem work —
 *  one definition, so the two cannot drift. */
export function isSafeSessionId(id: string): boolean {
  return id.length > 0 && id !== '.' && id !== '..'
    && !id.includes('/') && !id.includes('\\') && !id.includes('\0');
}

/** `clip-<YYYYmmdd-HHMMSS>-<rand4>.<ext>`. The random suffix is not decoration:
 *  the old one-second stamp let two clips filed in the same second overwrite
 *  each other. The extension is the REAL one — `ccd clip` called everything
 *  .png, so a downscaled JPEG lied about its format. */
export function clipName(ext: string, now: number, rand: string): string {
  const d = new Date(now);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `clip-${stamp}-${rand}.${ext}`;
}

/**
 * Where a clip goes, with containment asserted HERE rather than only in the
 * route. `id` arrives from a URL param, Fastify percent-decodes it, and in local
 * mode `writeFileB64` is an unguarded `mkdir -p` + write — so an id of
 * `../../.ssh` would write wherever it liked. Asserting at the write site
 * protects every future caller, not one handler.
 */
export function clipPath(clipsDir: string, id: string, name: string): string {
  if (!isSafeSessionId(id)) throw new Error('bad-session-id');
  return path.join(clipsDir, id, name);
}

/** Save the upload into the session's clips dir and report its path. Nothing is
 *  typed into the session — the path enters the prompt once, at send. */
export async function stageUpload(
  io: FleetIO,
  cfg: CcrcConfig,
  id: string,
  data: Buffer,
  ext: string,
  now: number = Date.now(),
  rand: string = randomBytes(2).toString('hex'),
): Promise<StagedClip> {
  const name = clipName(ext, now, rand);
  const full = clipPath(cfg.clipsDir, id, name);
  await io.writeFileB64(full, data.toString('base64'));
  return { path: full, name, bytes: data.byteLength };
}
