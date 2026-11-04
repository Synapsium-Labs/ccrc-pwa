// The PWA's precompressed assets (native Docs reader, the first-load compression plan of 2026-11-03). Once `vite build`
// has written the bundle, every script, stylesheet and SVG under `assets/` gets a Brotli copy (`<file>.br`) and a gzip
// copy (`<file>.gz`) beside it, and the server sends the copy a browser accepts (`server/src/pwaStatic.ts#pwaStaticOptions`,
// @fastify/static's `preCompressed`). `vite.config.ts#precompressAssets` runs it. Node's own `node:zlib`; no dependency.
//
// Only `assets/`: its names are content-hashed, so a copy can never sit beside a newer file of the same name, and its
// files are public and hold no secret and no request's input, so compressing them opens no compression side channel.
// A copy that is not smaller than its file is not written, each encoding decided alone. No file the build wrote changes
// its name or its bytes. One file at a time, synchronously: at quality 11 the encoder's memory is the bound to keep.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

/** The extensions compressed: the text formats the bundle emits under `assets/`. woff2 and png are compressed already. */
export const COMPRESSIBLE_EXTENSIONS: readonly string[] = ['.js', '.css', '.svg'];

/** Brotli's quality, by the coordinator's ruling of 2026-11-03: 11, its highest (the build pays it once; the hashed file
 *  is served, immutable, for a year), while a build stays within the ruling's bounds (this step at most 45 s, the build
 *  child at most 120 s, under the tests' 170 s timeout); otherwise 9. The switch is this one line. */
export const BROTLI_QUALITY = 11;

/** One encoding of one file: written beside it, or left out because it was not smaller than the file. */
export type CopyOutcome =
  | { readonly kind: 'written'; readonly bytes: number }
  | { readonly kind: 'not-smaller'; readonly bytes: number };

/** One compressible file and what was written beside it; `file` is relative to the directory given. */
export interface CompressedFile {
  readonly file: string;
  readonly bytes: number;
  readonly br: CopyOutcome;
  readonly gz: CopyOutcome;
}

/** Write `copy` to `target` only when it is smaller than the `original` bytes it encodes. */
function writeIfSmaller(target: string, copy: Buffer, original: number): CopyOutcome {
  if (copy.byteLength >= original) return { kind: 'not-smaller', bytes: copy.byteLength };
  writeFileSync(target, copy);
  return { kind: 'written', bytes: copy.byteLength };
}

/** Write `<file>.br` and `<file>.gz` beside every compressible file under `dir`, at any depth, one file at a time, in
 *  name order. A `dir` that is not there throws (ENOENT): a build with no `assets/` is a broken build. */
export function compressAssets(dir: string): CompressedFile[] {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && COMPRESSIBLE_EXTENSIONS.includes(path.extname(d.name)))
    .map((d) => path.join(d.parentPath, d.name))
    .sort();
  const out: CompressedFile[] = [];
  for (const file of files) {
    const bytes = readFileSync(file);
    const br = brotliCompressSync(bytes, {
      params: {
        [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
        [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.byteLength,
      },
    });
    const gz = gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION });
    out.push({
      file: path.relative(dir, file),
      bytes: bytes.byteLength,
      br: writeIfSmaller(`${file}.br`, br, bytes.byteLength),
      gz: writeIfSmaller(`${file}.gz`, gz, bytes.byteLength),
    });
  }
  return out;
}
