/**
 * The UTF-8 byte counter, defined once (desktop-polish carry, review 1389 A6). L0: it imports nothing, because the PWA
 * bundles `shared/*.ts`, and it allocates nothing.
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
