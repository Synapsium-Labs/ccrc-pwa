/**
 * The UTF-8 byte counter, defined once (desktop-polish carry, review 1389 A6). L0: it imports nothing, because the PWA
 * bundles `shared/*.ts`, and the counter allocates nothing.
 *
 * The count is what an encoder writes: 1 to 4 bytes a code point, a surrogate pair being one code point of 4 bytes, and a
 * lone surrogate 3, as `TextEncoder` writes U+FFFD for it. The ledgers' secret bound, the docs path bounds, the test box's
 * log line, the workspace title and the PWA's render gates each count bytes with it, so a bound the server checks and the
 * one the console shows are counted the same way.
 */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/** A string's UTF-8 bytes, as `TextEncoder` writes them (a lone surrogate as U+FFFD), for an L0 caller, which has no host byte API: the
 *  test box's `--repo=` word (D-8166) is base64url of these. */
export function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;   // a lone surrogate, as TextEncoder writes it
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/** Strict UTF-8 bytes to a string, or null: no overlong form, no surrogate, nothing past U+10FFFF, no truncated sequence. */
export function utf8Decode(bytes: readonly number[]): string | null {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i]!;
    const len = b < 0x80 ? 1 : b >= 0xc2 && b < 0xe0 ? 2 : b >= 0xe0 && b < 0xf0 ? 3 : b >= 0xf0 && b < 0xf5 ? 4 : 0;
    if (len === 0 || i + len > bytes.length) return null;
    let c = len === 1 ? b : b & (0xff >> (len + 1));
    for (let k = 1; k < len; k++) {
      const nb = bytes[i + k]!;
      if ((nb & 0xc0) !== 0x80) return null;
      c = (c << 6) | (nb & 63);
    }
    if ((len === 3 && c < 0x800) || (len === 4 && (c < 0x10000 || c > 0x10ffff)) || (c >= 0xd800 && c <= 0xdfff)) return null;
    out += String.fromCodePoint(c);
    i += len;
  }
  return out;
}
