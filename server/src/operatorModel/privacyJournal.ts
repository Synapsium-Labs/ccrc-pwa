// The privacy journal's format and its boot coherence (context C11, L1; Overlord W1 private store plan, Task 3; spec §7.6,
// H27). The journal sits on the chained kernel (`../chainedJournal.ts`) through the shared file adapter
// (`../chainedJournalFile.ts`, authority journal A0), bound by `OperatorModelStore`'s open (`./store.ts`). In W1 its one job
// is that no message id is ever issued twice, across a restore or a lost store: `recordMessage` appends a
// `privacy-message-issued` record inside the insert's transaction, before the row, and the next id starts above the
// journal's highest. It holds no words: an entry is ids and times only, and so is every piece its torn-tail heal keeps.
// Both kinds start `privacy-`, so they are disjoint from every other format's (`chained-journal-formats.test.ts`). W4's
// learning events join as more `privacy-` kinds. Pure: no fs, no clock.
import {
  chainedExactKeys, isRecord, type ChainedJournalErrorCode, type ChainedJournalFormat, type ChainedJournalRecord, type JournalWhere,
} from '../chainedJournal.js';

/** The journal's file and its torn-tail quarantine, both inside `~/.ccrc`. The quarantine is ONE path component, the
 *  adapter's contract (A0's `aside-dir-is-a-child-name`), never a full path. */
export const PRIVACY_JOURNAL_BASENAME = 'privacy-journal.log';
export const PRIVACY_JOURNAL_TORN_DIR = 'privacy-journal.torn';

const ANCHOR_REASON_MAP = {
  missing: 'no journal beside message rows',
  behind: "a journal whose highest id is below the store's",
} as const;
export type PrivacyAnchorReason = keyof typeof ANCHOR_REASON_MAP;
export const PRIVACY_ANCHOR_REASONS = Object.keys(ANCHOR_REASON_MAP) as PrivacyAnchorReason[];

export type PrivacyJournalEntry =
  | { readonly kind: 'privacy-message-issued'; readonly id: number; readonly at: number }
  | { readonly kind: 'privacy-anchor'; readonly highestId: number; readonly reason: PrivacyAnchorReason; readonly at: number };

const ENTRY_KEYS: Readonly<Record<PrivacyJournalEntry['kind'], readonly string[]>> = {
  'privacy-message-issued': ['kind', 'id', 'at'],
  'privacy-anchor': ['kind', 'highestId', 'reason', 'at'],
};

/** Every refusal of the privacy journal's grammar and of the kernel, as its own class. */
export class PrivacyJournalError extends Error {
  constructor(readonly code: ChainedJournalErrorCode, detail: string, readonly where?: JournalWhere) {
    super(`privacy journal ${code}: ${detail}${where?.line !== undefined ? ` (line ${where.line})` : ''}`);
    this.name = 'PrivacyJournalError';
  }
}
/** The canonical writer's refusal, as the privacy journal's own class. */
export class PrivacyJsonError extends Error {
  constructor(detail: string) {
    super(`privacy journal: ${detail}`);
    this.name = 'PrivacyJsonError';
  }
}

const refuse = (code: ChainedJournalErrorCode, detail: string): never => { throw new PrivacyJournalError(code, detail); };
const positiveId = (v: unknown, what: string): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : refuse('bad-field', `${what} is not a positive safe integer`);
const instantMs = (v: unknown, what: string): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : refuse('bad-field', `${what} is not a non-negative safe integer`);

/** The entry rebuilt field by field, or a `PrivacyJournalError`: exact keys, a known kind, positive ids. */
export function privacyJournalEntry(raw: unknown): PrivacyJournalEntry {
  if (!isRecord(raw)) return refuse('bad-field', 'the entry is not an object');
  const kind = raw.kind;
  if (kind !== 'privacy-message-issued' && kind !== 'privacy-anchor') return refuse('bad-field', `${JSON.stringify(kind)} is not a privacy kind`);
  chainedExactKeys(PRIVACY_JOURNAL_FORMAT, raw, ENTRY_KEYS[kind], `a ${kind} entry`);
  if (kind === 'privacy-message-issued') return { kind, id: positiveId(raw.id, 'id'), at: instantMs(raw.at, 'at') };
  const reason = raw.reason;
  if (reason !== 'missing' && reason !== 'behind') return refuse('bad-field', `${JSON.stringify(reason)} is not an anchor reason`);
  return { kind, highestId: positiveId(raw.highestId, 'highestId'), reason, at: instantMs(raw.at, 'at') };
}

export const PRIVACY_JOURNAL_FORMAT: ChainedJournalFormat<PrivacyJournalEntry, PrivacyJournalError> = {
  kinds: Object.keys(ENTRY_KEYS),
  entry: (raw) => privacyJournalEntry(raw),
  fail: (code, detail, where) => new PrivacyJournalError(code, detail, where),
  jsonError: (detail) => new PrivacyJsonError(detail),
};

/** The highest message id the journal's records name, issued or anchored, or null when they name none. */
export function privacyHighestId(records: readonly ChainedJournalRecord<PrivacyJournalEntry>[]): number | null {
  let high: number | null = null;
  for (const r of records) {
    const n = r.entry.kind === 'privacy-message-issued' ? r.entry.id : r.entry.highestId;
    if (high === null || n > high) high = n;
  }
  return high;
}

/** The journal as the boot read it: absent, read (its highest id, or null when it names none), or refused by the kernel or
 *  the port (each with its own code, never folded into one). */
export type PrivacyJournalSeen =
  | { readonly kind: 'absent' }
  | { readonly kind: 'read'; readonly highestId: number | null }
  | { readonly kind: 'refused'; readonly code: string; readonly detail: string };

export type PrivacyCoherence =
  | { readonly verdict: 'coherent'; readonly highestId: number | null }
  | { readonly verdict: 'fresh' }
  | { readonly verdict: 're-anchor'; readonly reason: PrivacyAnchorReason; readonly highestId: number }
  | { readonly verdict: 'refuse'; readonly code: string; readonly detail: string };

/** The boot verdict of the journal against the store (open question 10), total:
 *  - equal highest ids, or a journal ahead of the store (a crash between the append and the commit, or a store restored
 *    alone): `coherent`; the next id starts above the journal's highest;
 *  - no file, and no message rows: `fresh`;
 *  - no file beside message rows (`missing`), or a journal behind the store (`behind`): `re-anchor` at the store's highest;
 *  - a defect the kernel refuses that is not a healable torn tail, or a read the port could not make: `refuse`. */
export function privacyCoherence(journal: PrivacyJournalSeen, storeHighestId: number | null): PrivacyCoherence {
  if (journal.kind === 'refused') return { verdict: 'refuse', code: journal.code, detail: journal.detail };
  if (journal.kind === 'absent') {
    return storeHighestId === null ? { verdict: 'fresh' } : { verdict: 're-anchor', reason: 'missing', highestId: storeHighestId };
  }
  if (storeHighestId !== null && (journal.highestId === null || journal.highestId < storeHighestId)) {
    return { verdict: 're-anchor', reason: 'behind', highestId: storeHighestId };
  }
  return { verdict: 'coherent', highestId: journal.highestId };
}
