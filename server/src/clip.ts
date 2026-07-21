import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { CcrcConfig } from './config.js';
import type { Runner } from './exec.js';
import type { FleetIO } from './io.js';
import { ccd } from './lifecycle.js';

/**
 * Write the upload to cfg.uploadsDir/upload-<epochms>-<rand6>.<ext>, then hand
 * it to `ccd clip <file> <id>` — ccd moves it into ~/.cc-clips/<id>/ and types
 * its path into the session's prompt.
 */
export async function saveUploadAndClip(
  io: FleetIO,
  run: Runner,
  cfg: CcrcConfig,
  id: string,
  data: Buffer,
  ext: string,
): Promise<{ ok: boolean; stderr?: string }> {
  const file = path.join(cfg.uploadsDir, `upload-${Date.now()}-${randomBytes(3).toString('hex')}.${ext}`);
  await io.writeFileB64(file, data.toString('base64'));
  const r = await ccd(run, cfg, ['clip', file, id]);
  return r.ok ? { ok: true } : { ok: false, stderr: r.stderr };
}
