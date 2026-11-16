// Boot coherence of the Overlord authority journal (Overlord spec §7.6, Table 7.6a; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` Task 4, questions 5 and 6). Ring L1, context C5: it
// takes what the journal file and the rows hold and answers a word, with no fs, no clock and no randomness. The boot step and
// the writer (`overlordAuthorityJournal.ts`) gather the facts; the guard (`overlordAuthorityGuard.ts`) holds the answer.
//
// "The rows" are one singleton head row, `overlord_authority_head` (`coherence-reads-a-head-row`): the sequence, `journalId` and
// digest of the last record whose row committed, written only by the writer's apply step in the same transaction as the
// authority row it records. So each verdict of Table 7.6a is a comparison of two positions. A file holding another record at the
// row's sequence reads `diverged` (`coherence-diverged-verdict`). An unreadable file or row reads `unmeasured`, which refuses
// too and is never folded into `missing`.
import {
  chainedTailHealPlan, type ChainedJournalRecord, type ChainedPosition, type ChainedTail, type ChainedTailHealPlan,
} from '../chainedJournal.js';

/** The journal file as the adapter read and verified it (`ChainedFileRead`, with the read failure named). */
export type AuthorityFileSeen<E> =
  | { kind: 'absent' }
  | { kind: 'records'; records: readonly ChainedJournalRecord<E>[]; tail: ChainedTail | null }
  | { kind: 'malformed'; code: string; detail: string; lines: number }
  | { kind: 'unmeasured'; why: 'unreadable' };

/** The rows: the head row (or none), and whether any Overlord authority table holds a row; or `unmeasured` when either could
 *  not be read. */
export type AuthorityRowsSeen =
  | { kind: 'measured'; head: ChainedPosition | null; anyAuthorityRow: boolean }
  | { kind: 'unmeasured' };

/** Why boot coherence refuses: Table 7.6a's rows, and `diverged`. */
export type CoherenceCause = 'missing' | 'behind' | 'ahead' | 'trailing' | 'malformed' | 'diverged';

/** Every word of the guard's state, as TOTAL tables over its unions, for the coordination scanner
 *  (`overlordAuthorityJournal.ts#isOverlordAuthorityKebab`). */
export const AUTHORITY_STATE_WORDS: Readonly<Record<AuthorityState['kind'], true>> = { coherent: true, 'rolled-back': true, unmeasured: true };
export const AUTHORITY_STATE_CAUSES: Readonly<Record<Extract<AuthorityState, { kind: 'rolled-back' }>['cause'], true>> = {
  missing: true, behind: true, ahead: true, trailing: true, malformed: true, diverged: true, 'witness-epoch': true, 'witness-heads': true,
};
export const AUTHORITY_STATE_WHYS: Readonly<Record<Extract<AuthorityState, { kind: 'unmeasured' }>['why'], true>> = {
  journal: true, rows: true, 'privacy-head': true,
};

/** Table 7.6a's answer. Every verdict but `coherent` refuses. */
export type CoherenceVerdict =
  | { kind: 'coherent' }
  | { kind: 'rolled-back'; cause: CoherenceCause }
  | { kind: 'unmeasured'; why: 'journal' | 'rows' };

/** The guard's state: a coherence verdict, a rollback a witness found (PR B), or an unmeasured privacy head (PR B). Declared
 *  here, in L1, so the writer's L2 port can name it. */
export type AuthorityState =
  | { kind: 'coherent' }
  | { kind: 'rolled-back'; cause: CoherenceCause | 'witness-epoch' | 'witness-heads' }
  | { kind: 'unmeasured'; why: 'journal' | 'rows' | 'privacy-head' };

const samePosition = (a: ChainedPosition, b: ChainedPosition): boolean =>
  a.sequence === b.sequence && a.journalId === b.journalId && a.digest === b.digest;

/**
 * Table 7.6a, first match:
 *
 * | # | the file | the head row and the Overlord rows | verdict |
 * |---|---|---|---|
 * | 1 | unmeasured | any | unmeasured (journal) |
 * | 2 | any | unreadable | unmeasured (rows) |
 * | 3 | malformed, or a tail the heal did not take | any | malformed |
 * | 4 | absent (or no record) | no head row, and no Overlord row | coherent (a fresh box) |
 * | 5 | absent (or no record) | a head row or any Overlord row | missing |
 * | 6 | records | the head row equals the file's head | coherent |
 * | 7 | records | the record at the row's sequence is another record | diverged |
 * | 8 | records | the file's head is the row's sequence + 1 (or 1 with no head row) | trailing |
 * | 9 | records | the file's head is past that | ahead |
 * | 10 | records | the file's head is below the row's sequence | behind |
 *
 * The heal runs before this decider: a tail still here is one the heal refused.
 */
export function authorityCoherence<E>(file: AuthorityFileSeen<E>, rows: AuthorityRowsSeen): CoherenceVerdict {
  if (file.kind === 'unmeasured') return { kind: 'unmeasured', why: 'journal' };
  if (rows.kind === 'unmeasured') return { kind: 'unmeasured', why: 'rows' };
  if (file.kind === 'malformed' || (file.kind === 'records' && file.tail !== null)) return { kind: 'rolled-back', cause: 'malformed' };
  const records = file.kind === 'records' ? file.records : [];
  const last = records[records.length - 1];
  const head = rows.head;
  if (last === undefined) {
    return head === null && !rows.anyAuthorityRow ? { kind: 'coherent' } : { kind: 'rolled-back', cause: 'missing' };
  }
  if (head === null) return { kind: 'rolled-back', cause: last.sequence === 1 ? 'trailing' : 'ahead' };
  if (last.sequence < head.sequence) return { kind: 'rolled-back', cause: 'behind' };
  // A verified journal is complete from sequence 1, so the record at sequence n sits at index n - 1.
  const atRow = records[head.sequence - 1];
  if (atRow === undefined || !samePosition(atRow, head)) return { kind: 'rolled-back', cause: 'diverged' };
  if (last.sequence === head.sequence) return { kind: 'coherent' };
  return { kind: 'rolled-back', cause: last.sequence === head.sequence + 1 ? 'trailing' : 'ahead' };
}

/**
 * The heal rule for this journal: a torn tail is cut only by the kernel's rule, `chainedTailHealPlan(tail, prefixSound)`, where
 * `prefixSound` is "the complete records verify and the head row equals the last complete record" (no record and no head row
 * counts as equal). A tail after a head row that differs, or behind rows that could not be read, is not healed: it reads
 * `malformed`, and only Confirm the restore moves past it (question 17).
 */
export function authorityTailHeal<E>(file: AuthorityFileSeen<E>, rows: AuthorityRowsSeen): ChainedTailHealPlan | null {
  if (file.kind !== 'records' || file.tail === null || rows.kind !== 'measured') return null;
  const last = file.records[file.records.length - 1];
  const head = rows.head;
  const prefixSound = last === undefined ? head === null : head !== null && samePosition(last, head);
  return chainedTailHealPlan(file.tail, prefixSound);
}
