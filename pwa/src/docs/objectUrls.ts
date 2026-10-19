// The Docs screen's object URLs and saves (spec 2026-10-01 5.4; W5 part 1 Task 7; refinement (t)). This file is the
// ONLY place under `pwa/src/docs` and `pwa/src/lib/markdown*` that calls `URL.createObjectURL` or builds a `Blob`. A
// raster gets an object URL typed exactly as L0's raster table says; every save is an `application/octet-stream` blob,
// clicked through a detached `<a download>` inside the call and revoked 30 s later. It never makes a `blob:` URL of
// SVG, HTML or any other active type: opened top-level, such a URL is a same-origin document carrying the session
// (spec 5.4, E6). An SVG on a page is a `data:` URL instead (`DocImage`, spec 5.5).
import { DOCS_RASTER_TYPES, contentClass, type DocPin, type DocsShowOk, type RasterMime } from '../../../shared/docs';
import { api } from '../lib/api';
import { DOCS_SHOW_NO_BYTES } from './docsText';
import type { DocsAnswer, DocsLoaders } from './failures';

/** The four raster MIME types, from the table and nowhere else. */
const RASTER_MIMES: readonly RasterMime[] = Object.values(DOCS_RASTER_TYPES).map((t) => t.mime);

/** The one type every save is built with (spec 5.4: an octet-stream blob downloads; it never renders). */
const OCTET_STREAM = 'application/octet-stream';

/** How long a save's object URL lives after its click (spec 5.4: "revokes the URL after 30 s"). */
export const DOCS_SAVE_REVOKE_MS = 30000;

/** An object URL for verified raster bytes (spec 5.4). The Blob's type is the table's own string for `mime`, and any
 *  `mime` that is not one of the four table values, by exact comparison, THROWS: a programming error, never an image.
 *  The caller revokes the URL when the image goes. */
export function rasterObjectUrl(bytes: Uint8Array<ArrayBuffer>, mime: RasterMime): string {
  const type = RASTER_MIMES.find((m) => m === mime);
  if (type === undefined) throw new Error(`rasterObjectUrl: '${String(mime)}' is not a raster type`);
  return URL.createObjectURL(new Blob([bytes], { type }));
}

/** THE save primitive (spec 5.4, amended 2026-10-13): `bytes` as an `application/octet-stream` blob, clicked through a
 *  detached `<a download=name>` synchronously inside this call (no `await` anywhere before the click, so a click
 *  handler that calls it keeps its user activation), the URL revoked `DOCS_SAVE_REVOKE_MS` later. */
export function saveBytes(name: string, bytes: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([bytes], { type: OCTET_STREAM }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), DOCS_SAVE_REVOKE_MS);
}

/** A docs-show answer's bytes: `utf8` text encoded as UTF-8, `base64` decoded. `null` has ONE meaning: the answer
 *  holds no bytes in the field its encoding names (the field is missing, or the base64 does not decode). */
export function showBytes(show: DocsShowOk): Uint8Array<ArrayBuffer> | null {
  if (show.encoding === 'base64') {
    if (typeof show.b64 !== 'string') return null;
    let binary: string;
    try {
      binary = atob(show.b64);
    } catch {
      return null;
    }
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  }
  return typeof show.text === 'string' ? new TextEncoder().encode(show.text) : null;
}

/** Download (spec 5.4): a file's original bytes, saved through `saveBytes` as `basename`, octet-stream for EVERY class.
 *  A raster path reads through `loaders.raster`, every other through `loaders.file`; `loaders` absent means `api.docs`.
 *  Answers `{s: 'ok'}` once the click is made, the loader's own failure as is (nothing saved), or a client-built
 *  `malformed-answer` when a docs-show answer holds no bytes. */
export async function downloadDocFile(project: string, pin: DocPin, basename: string,
  loaders: Pick<DocsLoaders, 'file' | 'raster'> = api.docs): Promise<DocsAnswer<void>> {
  let bytes: Uint8Array<ArrayBuffer>;
  if (contentClass(pin.path) === 'raster') {
    const answer = await loaders.raster(project, pin);
    if (answer.s !== 'ok') return answer;
    bytes = answer.value.bytes;
  } else {
    const answer = await loaders.file(project, pin);
    if (answer.s !== 'ok') return answer;
    const shown = showBytes(answer.value.show);
    if (shown === null) {
      return { s: 'failed', body: { ok: false, failure: 'malformed-answer', why: DOCS_SHOW_NO_BYTES } };
    }
    bytes = shown;
  }
  saveBytes(basename, bytes);
  return { s: 'ok', value: undefined };
}
