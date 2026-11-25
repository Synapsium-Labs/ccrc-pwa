// The privacy journal's head, as the Overlord authority witness reads it (Overlord W1 authority journal plan, Task 5, question 11,
// slug `privacy-head-wired-by-the-second`). Ring L2, context C5: the port is declared by its consumer, the epoch and the witness
// verdict. The privacy journal is private store A's; whichever of the two pull requests lands second wires an adapter in `index.ts`
// in one line, and until then `PRIVACY_HEAD_UNWIRED` stands in, which answers `absent`.
//
// Failure contract: `read` answers and never throws. `absent` is a build with no privacy journal (the port is not wired), `empty` is
// a wired journal holding no record (`privacy-empty-is-its-own-word`), and `unmeasured` is a journal that could not be read: it
// makes the epoch unmeasured and is never read as `absent` or `empty`. `digestAt` answers the digest of the record at a sequence,
// `null` when the journal holds no record there, and `'unmeasured'` when it could not read.

export type PrivacyHeadRead =
  | { kind: 'absent' }
  | { kind: 'empty' }
  | {
    kind: 'head'; sequence: number; digest: string; highestMessageId: number | null;
    digestAt(sequence: number): string | null | 'unmeasured';
  }
  | { kind: 'unmeasured'; why: string };

export interface PrivacyJournalHead { read(): PrivacyHeadRead }

/** The port before the privacy journal is wired: every read answers `absent`. */
export const PRIVACY_HEAD_UNWIRED: PrivacyJournalHead = { read: () => ({ kind: 'absent' }) };
