// The text of a range read's bytes (X2 P6.1 Step 0c; spec 2026-11-18 4.3, 4.4's not-UTF-8 row). Ring L1: pure, no React and no IO.
//
// One decoder for the two readers of a range read's bytes: the leaf, which shows the text, and the head, which compares what a body
// published with the text the read gave (Export of a document read by range acts on the whole text only when the body shows it).
// Both ask for the same bytes array, so both get the same string: the answer is kept per array, never decoded twice.

/** The bytes a range read gave, decoded as UTF-8. `utf8: false` carries the lossy decoding, for the plain view with its note (spec
 *  4.4's not-UTF-8 row); a file that is not UTF-8 is never parsed. */
export interface DecodedRangeBytes { readonly utf8: boolean; readonly text: string }

const DECODED = new WeakMap<Uint8Array<ArrayBuffer>, DecodedRangeBytes>();

/** `bytes` decoded: a fatal UTF-8 decode, else the lossy one with `utf8` false. The same array gives the same answer object, so
 *  the same text string, however many callers ask. */
export function decodeRangeBytes(bytes: Uint8Array<ArrayBuffer>): DecodedRangeBytes {
  const held = DECODED.get(bytes);
  if (held !== undefined) return held;
  let decoded: DecodedRangeBytes;
  try {
    decoded = { utf8: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) };
  } catch {
    decoded = { utf8: false, text: new TextDecoder('utf-8').decode(bytes) };
  }
  DECODED.set(bytes, decoded);
  return decoded;
}
