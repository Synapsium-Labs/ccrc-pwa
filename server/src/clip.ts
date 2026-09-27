import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { CLIP_EXT_ALT } from '../../shared/api.js';
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

/** One clip filename: no directory part, no dots to climb with. Exported so the
 *  prompt and clip routes validate against the same shape the writer produces.
 *  The extension half is DERIVED from `CLIP_EXTS` rather than spelled again —
 *  a name this refuses is a name the clip route cannot serve, so the two lists
 *  drifting apart would strand a staged file behind a 400. */
export const CLIP_NAME_RE = new RegExp(`^clip-[A-Za-z0-9._-]+\\.(?:${CLIP_EXT_ALT})$`);

/**
 * Content-Type for the clip route, keyed by the (real) extension `clipName`
 * wrote. It lives beside the writer, not in the route, so that `clip.test.ts`
 * can hold it against `CLIP_EXTS` — an admitted extension with no entry here
 * would be served as `application/octet-stream`, which is a silent download
 * prompt instead of the document the user tapped.
 *
 * Nothing here is a script type, and nothing ever should be: these are bytes a
 * client uploaded, served back from the app's OWN origin. `text/html` or
 * `image/svg+xml` in this table would make the clip route a same-origin script
 * host. The route also sends `nosniff`, so a browser cannot promote one of
 * these to HTML on its own.
 */
export const CLIP_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  md: 'text/markdown', txt: 'text/plain', log: 'text/plain',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  yaml: 'text/yaml', yml: 'text/yaml', rtf: 'application/rtf', pdf: 'application/pdf',
};

/**
 * The part of an uploaded file's OWN name worth carrying into the clip name.
 *
 * Images never needed this — you can see which one you attached. A document
 * cannot be seen: four of them are four indistinguishable lines in the prompt,
 * and the name is the only thing that says which is the spec and which is the
 * log. So the stem rides along, sanitised to exactly what `CLIP_NAME_RE`
 * admits (`[A-Za-z0-9._-]`), stripped of leading dots and dashes so it cannot
 * open a name with one, and capped — a 300-character filename is a real thing
 * a phone will hand over, and the stamp and random suffix still have to fit.
 *
 * Returns '' when nothing survives, which is the ORIGINAL name shape and still
 * valid: the stem is an aid to the reader, never part of the contract.
 */
export function clipStem(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1).replace(/\.[^.]*$/, '');
  return base
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.\-]+/, '')
    .slice(0, 40)
    .replace(/[.\-]+$/, '');
}

/** `clip-<YYYYmmdd-HHMMSS>-<rand>[-<stem>].<ext>`. The random suffix is not
 *  decoration: the old one-second stamp let two clips filed in the same second
 *  overwrite each other. The extension is the REAL one — `ccd clip` called
 *  everything .png, so a downscaled JPEG lied about its format. `stem` is the
 *  uploader's own name, already sanitised by `clipStem`, and defaults to ''
 *  (the original shape) — it is APPENDED after `rand` so the collision-proof
 *  part of the name can never be pushed out by a long one. */
export function clipName(ext: string, now: number, rand: string, stem = ''): string {
  const d = new Date(now);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `clip-${stamp}-${rand}${stem === '' ? '' : `-${stem}`}.${ext}`;
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
  if (!CLIP_NAME_RE.test(name)) throw new Error('bad-clip-name');
  const root = path.resolve(clipsDir);
  const full = path.resolve(root, id, name);
  // Belt and braces, and NOT dead: the two guards above are lexical, and this is
  // the assertion that the composed path actually lands inside the clips dir.
  // An earlier revision dropped it and the `name` argument could escape.
  if (!full.startsWith(root + path.sep)) throw new Error('bad-clip-name');
  return full;
}

/** Save the upload into the session's clips dir and report its path. Nothing is
 *  typed into the session — the path enters the prompt once, at send.
 *
 *  32 bits of `rand`, not 16: a multi-image paste uploads four files in the same
 *  second BY DESIGN, and a name collision here is silent data loss — the second
 *  write overwrites the first, both chips report the same path, and the composed
 *  prompt names one image twice while the other never reaches Claude. The clip
 *  route serves these `immutable`, so a cached collision never heals. */
export async function stageUpload(
  io: FleetIO,
  cfg: CcrcConfig,
  id: string,
  data: Buffer,
  ext: string,
  now: number = Date.now(),
  rand: string = randomBytes(4).toString('hex'),
  stem = '',
): Promise<StagedClip> {
  const name = clipName(ext, now, rand, stem);
  const full = clipPath(cfg.clipsDir, id, name);
  await io.writeFileB64(full, data.toString('base64'));
  return { path: full, name, bytes: data.byteLength };
}
