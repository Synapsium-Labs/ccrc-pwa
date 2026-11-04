// The reader lab's wall-frame policy (native Docs reader, the reader lab plan of 2026-11-03, Task 6, refinement (i); the
// rich-docs spec's row M10.10). Ring L1: pure. The lab's wall frame runs its battery under the shared Markdown library's
// own frame policy with exactly two sources added: the frame's script nonce in `script-src`, so the battery's own inline
// script runs, and one image URL, the run's canary, in `img-src`, which the battery requests first as its sign that it
// ran. Everything else is `frameCsp()` as the reader frame carries it, so the walls the lab measures are the reader's.
// This file lives under `docs/reader/` because that is the one home of the library's `./frame` (M8.10).
import { FRAME_MANIFEST, frameCsp } from '@synapsium-labs/docserver/frame';

/** The library build the lab ran against: the first twelve hex digits of its enhance asset's sha256. */
export const READER_LIBRARY_BUILD: string = FRAME_MANIFEST.enhance.sha256.slice(0, 12);

/** One CSP nonce source. */
const NONCE_SOURCE = /^'nonce-[A-Za-z0-9+/_-]+={0,2}'$/;
/** One URL source: a scheme, a host and a path, with no character a policy splits on or quotes with. */
const URL_SOURCE = /^https?:\/\/[^\s;,'"]+$/;

/** The wall frame's policy. Throws a TypeError for a source that is not exactly one nonce or one URL: the lab builds
 *  both, so that is a defect. */
export function labWallCsp(nonceSource: string, canary: string): string {
  if (!NONCE_SOURCE.test(nonceSource)) throw new TypeError('labWallCsp: not one nonce source');
  if (!URL_SOURCE.test(canary)) throw new TypeError('labWallCsp: not one URL source');
  let scripts = 0;
  let images = 0;
  const out = frameCsp().split(';').map((d) => d.trim()).filter((d) => d !== '').map((d) => {
    const name = d.split(/\s+/)[0];
    if (name === 'script-src') {
      scripts += 1;
      return `${d} ${nonceSource}`;
    }
    if (name === 'img-src') {
      images += 1;
      return `${d} ${canary}`;
    }
    return d;
  });
  if (scripts !== 1 || images !== 1) throw new Error('labWallCsp: the library policy no longer has one script-src and one img-src');
  return out.join('; ');
}
