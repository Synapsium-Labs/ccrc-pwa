/**
 * THE COMMAND REDACTOR (D-5299, coordinator-first routing spec 2026-10-17 section 6.7). Pure: no I/O.
 *
 * A child's tool input is untrusted text, and it can carry a secret the child pasted into a command. Before any input
 * is stored on an approval row, mailed to a coordinator, put in a digest or shown on a surface, `redactCommand` masks
 * the token-shaped strings in it. THE RULES ARE NOT HERE (D-5867, ARCH-66 (#801)): they are the `egress` profile of
 * `shared/redact.mjs`, the one rule table, and its header lists every shape masked and every shape still kept. This
 * file is the egress profile's caller: the one word `[REDACTED]`, the caps, and the two forms an approval row and its
 * digest line take. The digest a ruling is signed over is of the UNREDACTED input, which the server holds only for
 * the request (spec section 6.7). The length caps sit here too, so the stored form and the digest line are each cut in
 * one place.
 */
import { credentialMaskSource } from '../../../shared/api.js';
import { EGRESS_MASK, redact } from '../../../shared/redact.js';

/** The one mask. */
export const REDACTED = EGRESS_MASK;

/** The stored form's cap, in UTF-8 bytes (spec §6.7: "capped at 16 KB"). */
export const APPROVAL_INPUT_MAX_BYTES = 16 * 1024;

/** The digest line's preview, in characters (spec §6.7: "the first 160 redacted characters"). */
export const APPROVAL_DIGEST_PREVIEW_CHARS = 160;

/** The generic `sk-` and JWT shapes the egress profile reads, from `CREDENTIAL_MASKS` (D-5513, accounts plan Task
 *  A10): one home for each shape, and `shared/redact.mjs` imports nothing. */
const SHAPES = { genericSk: credentialMaskSource('genericSk'), jwt: credentialMaskSource('jwt') } as const;

/** Masks every token-shaped string in `text` (the shapes `shared/redact.mjs` lists). */
export function redactCommand(text: string): string {
  return redact('egress', text, SHAPES);
}

/** `text` cut to at most `maxBytes` UTF-8 bytes, never inside a character. */
export function capUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  let out = '';
  let bytes = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > maxBytes) break;
    out += ch;
    bytes += n;
  }
  return out;
}

/** The form an approval row stores: redacted, then capped. */
export function redactedStored(text: string): string {
  return capUtf8(redactCommand(text), APPROVAL_INPUT_MAX_BYTES);
}

/** The digest line's preview: the first `APPROVAL_DIGEST_PREVIEW_CHARS` characters of the redacted text. */
export function redactedPreview(text: string): string {
  return [...redactCommand(text)].slice(0, APPROVAL_DIGEST_PREVIEW_CHARS).join('');
}
