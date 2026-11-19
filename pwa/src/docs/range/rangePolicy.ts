// L1 policy (X2 P1 Task P1.4; X2 spec section 4.3): the range read's pure decisions. Which route a leaf's bytes take,
// whether an image may be decoded for its own page, and the dimensions an image's header declares, read before any
// decode. No I/O, no timers, no DOM: the loader and the views act on these answers.
import {
  DOCS_CLASS_CAP, DOCS_IMAGE_VIEW_MAX_PIXELS, DOCS_IMAGE_VIEW_MAX_SIDE, DOCS_RANGE_MAX_BYTES,
  type DocContentClass, type DocsRangePin,
} from '../../../../shared/docs';

/** How a leaf's bytes are read (spec 4.3).
 *  - `show`: the class-capped file route, as before (at most the class cap, pinned by blob or fingerprint).
 *  - `range`: `docs-show-range` frames, for a file above its class cap up to the range ceiling, and for EVERY
 *    stat-pinned file whatever its size, because `docs-show` reads a draft only by its fingerprint.
 *  - `over-ceiling`: above `DOCS_RANGE_MAX_BYTES`, or a size that is not a whole byte count: nothing is read. */
export function rangeVerdict(size: number, cls: DocContentClass, pin: DocsRangePin['kind']): 'show' | 'range' | 'over-ceiling' {
  if (!Number.isSafeInteger(size) || size < 0 || size > DOCS_RANGE_MAX_BYTES) return 'over-ceiling';
  if (pin === 'stat') return 'range';
  return size > DOCS_CLASS_CAP[cls] ? 'range' : 'show';
}

/** Whether an image may be decoded for its own page, from the dimensions `imageHeaderDims` read (each at least 1):
 *  `side` when either side passes `DOCS_IMAGE_VIEW_MAX_SIDE`, else `pixels` when the area passes
 *  `DOCS_IMAGE_VIEW_MAX_PIXELS`; `show` otherwise. Decided before any decode, so a small file that declares a huge
 *  image is never decoded. */
export function imageViewVerdict(dims: { w: number; h: number }): 'show' | 'side' | 'pixels' {
  if (dims.w > DOCS_IMAGE_VIEW_MAX_SIDE || dims.h > DOCS_IMAGE_VIEW_MAX_SIDE) return 'side';
  return dims.w * dims.h > DOCS_IMAGE_VIEW_MAX_PIXELS ? 'pixels' : 'show';
}

/** Base64 text as bytes, or `null` when it is not base64. The one decoder for docs answers: `showBytes` and the range
 *  read both use it. */
export function b64Bytes(b64: string): Uint8Array<ArrayBuffer> | null {
  let binary: string;
  try {
    binary = atob(b64);
  } catch {
    return null;
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10] as const;

const u16be = (b: Uint8Array, i: number): number => (b[i]! << 8) | b[i + 1]!;
const u16le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8);
const u24le = (b: Uint8Array, i: number): number => b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16);
const u32be = (b: Uint8Array, i: number): number => ((b[i]! << 24) >>> 0) + ((b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!);
const ascii = (b: Uint8Array, i: number, s: string): boolean =>
  b.length >= i + s.length && [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/** PNG: the IHDR chunk, which must be the first chunk, at byte 8, with its length 13: the size checked is the one the
 *  decoder uses. */
function pngDims(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 24 || !PNG_SIG.every((v, i) => b[i] === v)) return null;
  if (u32be(b, 8) !== 13 || !ascii(b, 12, 'IHDR')) return null;
  return { w: u32be(b, 16), h: u32be(b, 20) };
}

/** JPEG: walk the marker segments from byte 2 to the first SOF (C0 to CF, less C4 DHT, C8 JPG and CC DAC). A segment
 *  that runs past the bytes, or a byte that is not a marker, ends the walk with no answer. */
function jpegDims(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]!;
    if (m === 0xff) { i += 1; continue; }
    if (m === 0xd9) return null;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = u16be(b, i + 2);
    if (len < 2 || i + 2 + len > b.length) return null;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (len < 7) return null;
      return { w: u16be(b, i + 7), h: u16be(b, i + 5) };
    }
    i += 2 + len;
  }
  return null;
}

/** GIF: the logical screen, grown to hold the first frame's image descriptor (`left + width`, `top + height`), as the
 *  browsers' GIF readers grow it, so a 1 by 1 screen whose first frame is huge is read as huge. The walk skips the global
 *  colour table and every extension block before the first descriptor (`0x2C`); a header cut short, or a trailer before
 *  any frame, answers null. */
function gifDims(b: Uint8Array): { w: number; h: number } | null {
  if (b.length < 13 || !(ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return null;
  const sw = u16le(b, 6);
  const sh = u16le(b, 8);
  let i = 13 + ((b[10]! & 0x80) !== 0 ? 3 * (2 << (b[10]! & 7)) : 0);
  while (i < b.length) {
    const t = b[i]!;
    if (t === 0x2c) {
      if (i + 9 > b.length) return null;
      return { w: Math.max(sw, u16le(b, i + 1) + u16le(b, i + 5)), h: Math.max(sh, u16le(b, i + 3) + u16le(b, i + 7)) };
    }
    if (t !== 0x21 || i + 2 > b.length) return null;
    i += 2; // the introducer and the label
    for (;;) {
      if (i >= b.length) return null;
      const n = b[i]!;
      i += 1 + n;
      if (n === 0) break;
    }
  }
  return null;
}

/** WebP: `RIFF` at 0 and `WEBP` at 8, then the first chunk at 12: `VP8 ` (its start code, then 14-bit sizes),
 *  `VP8L` (its signature byte, then two packed 14-bit sizes less one) or `VP8X` (24-bit sizes less one). */
function webpDims(b: Uint8Array): { w: number; h: number } | null {
  if (!ascii(b, 0, 'RIFF') || !ascii(b, 8, 'WEBP')) return null;
  if (ascii(b, 12, 'VP8 ')) {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { w: u16le(b, 26) & 0x3fff, h: u16le(b, 28) & 0x3fff };
  }
  if (ascii(b, 12, 'VP8L')) {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = (b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24)) >>> 0;
    return { w: (bits & 0x3fff) + 1, h: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (ascii(b, 12, 'VP8X')) {
    if (b.length < 30) return null;
    return { w: u24le(b, 24) + 1, h: u24le(b, 27) + 1 };
  }
  return null;
}

/** The width and height an image's header declares, read from its first bytes before any decode: PNG, JPEG, GIF or
 *  WebP. `null` has one meaning: these bytes declare no dimensions this reader can trust (another type, or a header cut
 *  short or out of order), and the image is not shown on its own page. */
export function imageHeaderDims(bytes: Uint8Array): { w: number; h: number } | null {
  const d = pngDims(bytes) ?? jpegDims(bytes) ?? gifDims(bytes) ?? webpDims(bytes);
  // A side of 0 (a JPEG whose height its frame header defers) declares nothing this reader can check.
  return d === null || d.w < 1 || d.h < 1 ? null : d;
}
