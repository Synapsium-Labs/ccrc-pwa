// The Overlord act journal's signed head: its shape, its domain-separated preimage, and the console's check that a newer head
// extends the one it kept (Overlord spec §7.6 H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-journal.md`
// Task A3, questions 7 and 11). Ring L0, context K: it imports nothing, because the PWA bundles it, and the server's signer and
// the console's verify read the one preimage built here, so the bytes the key signed and the bytes WebCrypto checks cannot
// drift apart.
//
// THE PREIMAGE (question 7): the domain tag, one LF, then the RFC 8785 JSON of `{ day, digest, journalId, sequence }`. The tag
// makes it no other kind's preimage: an approval ruling's signed bytes are a JSON object, and these start with the tag. The
// fields are held to shapes whose RFC 8785 form is plain `JSON.stringify` of each value in key order (an ISO day, two lowercase
// hex digests and a positive safe integer: no escape, no float), so no canonical encoder is needed here; the server's suite
// checks the bytes against `canonical.ts#rfc8785Json`.

/** The domain tag of a signed act journal head. */
export const ACT_HEAD_DOMAIN = 'ccrc/overlord-act-journal-head/v1';

/** One signed head: the day it was taken (the digest's own day), and the journal's head record at that moment. */
export interface ActHead {
  readonly day: string;
  readonly sequence: number;
  readonly journalId: string;
  readonly digest: string;
}

const DAY_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const isSequence = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;

/** Whether a value is a head in shape: a day, a positive sequence and two lowercase hex digests. */
export function isActHead(v: unknown): v is ActHead {
  if (typeof v !== 'object' || v === null) return false;
  const h = v as Record<string, unknown>;
  return typeof h.day === 'string' && DAY_RE.test(h.day) && isSequence(h.sequence)
    && typeof h.journalId === 'string' && HEX64_RE.test(h.journalId) && typeof h.digest === 'string' && HEX64_RE.test(h.digest);
}

/** The bytes a head's signature covers, as text, or `null` for a head out of shape (nothing out of shape is ever signed). */
export function actHeadPreimage(head: ActHead): string | null {
  if (!isActHead(head)) return null;
  // RFC 8785 orders keys by UTF-16 code units: day, digest, journalId, sequence.
  return `${ACT_HEAD_DOMAIN}\n{"day":${JSON.stringify(head.day)},"digest":${JSON.stringify(head.digest)},"journalId":${JSON.stringify(head.journalId)},"sequence":${head.sequence}}`;
}

/** What the console keeps of the last head it verified, and what a newer read offers. */
export interface HeadPosition { readonly sequence: number; readonly digest: string }

/** What the journal answered for the record at the kept head's sequence: its digest, `absent` (no record there: the journal is
 *  shorter than it was), or `unmeasured` (the read failed). */
export type DigestAtKept = string | 'absent' | 'unmeasured';

const HEAD_EXTENDS_MAP = {
  extends: 'the offered head is at or past the kept one, and the journal still holds the kept record with its digest',
  'does-not-extend': 'the journal went back or was rewritten: it no longer holds the kept record as it was',
  first: 'nothing was kept on this device yet, so there is nothing to compare',
  unmeasured: 'the record at the kept sequence could not be read, or an input is out of shape',
} as const;
export type HeadExtends = keyof typeof HEAD_EXTENDS_MAP;
export const HEAD_EXTENDS_ANSWERS = Object.keys(HEAD_EXTENDS_MAP) as HeadExtends[];

const isPosition = (p: unknown): p is HeadPosition =>
  typeof p === 'object' && p !== null && isSequence((p as HeadPosition).sequence) && typeof (p as HeadPosition).digest === 'string'
  && HEX64_RE.test((p as HeadPosition).digest);

/** Whether `offered` extends `kept` (question 11: one comparison, shared with PR B's witness). Nothing kept is `first`; an
 *  unreadable record or an input out of shape is `unmeasured`, never a verdict either way; an offered head behind the kept
 *  one, a kept record the journal no longer holds, or one it holds with another digest is `does-not-extend`. */
export function headExtends(kept: HeadPosition | null, offered: HeadPosition, digestAtKept: DigestAtKept): HeadExtends {
  if (kept === null) return isPosition(offered) ? 'first' : 'unmeasured';
  if (!isPosition(kept) || !isPosition(offered)) return 'unmeasured';
  if (digestAtKept !== 'absent' && !HEX64_RE.test(digestAtKept)) return 'unmeasured';
  if (offered.sequence < kept.sequence) return 'does-not-extend';
  if (offered.sequence === kept.sequence && offered.digest !== kept.digest) return 'does-not-extend';
  if (digestAtKept === 'absent' || digestAtKept !== kept.digest) return 'does-not-extend';
  return 'extends';
}
