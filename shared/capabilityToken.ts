// The capability token's grammar (native Docs HTML artifacts X5, plan Task A1.1; moved here from `shared/docsReview.ts`,
// which re-exports it under its own names). L0: imports nothing. The one definition of the grammar.

/** The characters of a capability token: 32 random bytes, base64url without padding. */
export const CAPABILITY_TOKEN_CHARS = 43;

/** The capability token: 32 random bytes, base64url without padding, so 43 characters. The one grammar of it. */
export const CAPABILITY_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function isCapabilityToken(s: string): boolean {
  return typeof s === 'string' && CAPABILITY_TOKEN_RE.test(s);
}
