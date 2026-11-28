// Whether today's act journal head is signed (Overlord spec §7.6 H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/
// w2-act-journal.md` Task A3, question 8). Ring L1, context C5: pure. The head-signing lane (L4) reads the isolation word and the
// approvals kill switch, asks this, and either signs through the signer's typed method or records the head unsigned with the
// word this answers. The head's table and its one writer are the store's (`overlordActHeadStore.ts`, L3).
//
// UNSIGNED WHERE THE KEY IS REACHABLE (slug `act-head-unsigned-where-the-key-is-reachable`). On `shared-user` a session can read
// the server's key, so a signature would vouch for nothing; an unmeasured isolation word acts as `shared-user` (the isolation
// piece's rule) and is named apart; and while the operator's `approvals-disabled` switch stands the key signs nothing at all.
// The switch is asked first: it is the operator's explicit word that the key is not to sign, whatever the isolation.
import type { IsolationRead } from '../../../shared/isolation.js';

const ACT_HEAD_UNSIGNED_MAP = {
  'approvals-disabled': "the operator's approvals-disabled switch stands, so the server's key signs nothing",
  'shared-user': "the sessions run as the server's user, so the key is within their reach and a signature would vouch for nothing",
  'isolation-unmeasured': "the isolation word could not be measured, so it acts as shared-user and the head is not signed",
  'key-unavailable': "the server's signing key could not be loaded, so the head is recorded without a signature",
} as const;
export type ActHeadUnsigned = keyof typeof ACT_HEAD_UNSIGNED_MAP;
export const ACT_HEAD_UNSIGNED_WORDS = Object.keys(ACT_HEAD_UNSIGNED_MAP) as ActHeadUnsigned[];

export type ActHeadSignVerdict = { readonly sign: true } | { readonly sign: false; readonly unsigned: ActHeadUnsigned };

/** Sign on `separate-user` and `separate-host` with a key that loaded; otherwise record the head unsigned with the word that
 *  says why. A key that could not be loaded is asked last: the head is unsigned for the stronger reason first. */
export function actHeadSignVerdict(f: {
  readonly isolation: IsolationRead; readonly approvalsDisabled: boolean; readonly keyAvailable: boolean;
}): ActHeadSignVerdict {
  if (f.approvalsDisabled) return { sign: false, unsigned: 'approvals-disabled' };
  if (f.isolation.kind !== 'measured') return { sign: false, unsigned: 'isolation-unmeasured' };
  if (f.isolation.word === 'shared-user') return { sign: false, unsigned: 'shared-user' };
  if (!f.keyAvailable) return { sign: false, unsigned: 'key-unavailable' };
  return { sign: true };
}

/** The journal's head as the lane read it: the last verified record, none (a file with no record, or no file), or a read that
 *  did not verify (unreadable, malformed, or a torn tail the boot heal has not cut). */
export type ActHeadLaneFile =
  | { readonly kind: 'head'; readonly sequence: number; readonly journalId: string; readonly digest: string }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unverified'; readonly why: string };

export type ActHeadLanePlan =
  | { readonly kind: 'nothing'; readonly why: 'recorded-today' | 'no-record' }
  | { readonly kind: 'warn'; readonly why: string }
  | { readonly kind: 'record'; readonly verdict: ActHeadSignVerdict };

/** One beat of the head-signing lane (Task A3): today's row standing, or a journal with no record, writes nothing and says
 *  nothing new (every box at merge: no act is written before the Overlord's route word); a today's row that cannot be read, or a
 *  journal that does not verify, writes nothing and warns; otherwise today's head is recorded, signed or unsigned as the verdict
 *  says. Today's row is read before the file, so a recorded day costs no file read. */
export function actHeadLanePlan(f: {
  readonly today: 'present' | 'absent' | { readonly unmeasured: string };
  readonly file: () => ActHeadLaneFile;
  readonly verdict: () => ActHeadSignVerdict;
}): ActHeadLanePlan {
  if (f.today === 'present') return { kind: 'nothing', why: 'recorded-today' };
  if (f.today !== 'absent') return { kind: 'warn', why: `today's head row could not be read: ${f.today.unmeasured}` };
  const file = f.file();
  if (file.kind === 'empty') return { kind: 'nothing', why: 'no-record' };
  if (file.kind === 'unverified') return { kind: 'warn', why: `the act journal did not verify: ${file.why}` };
  return { kind: 'record', verdict: f.verdict() };
}

/** The digest of the journal's record at `at`, from one verified read: `absent` past the head (or no record), `unmeasured` for a
 *  read that did not verify. A verified journal is complete from sequence 1, so the record at `n` sits at index `n - 1`; a torn
 *  tail does not hide the complete records before it. Three answers, never folded (point 3). */
export function digestAtSequence(
  read: { readonly kind: 'absent' } | { readonly kind: 'records'; readonly records: readonly { readonly sequence: number; readonly digest: string }[] }
    | { readonly kind: 'malformed' } | { readonly kind: 'unmeasured' },
  at: number,
): string | 'absent' | 'unmeasured' {
  if (read.kind === 'malformed' || read.kind === 'unmeasured') return 'unmeasured';
  if (read.kind === 'absent') return 'absent';
  const rec = read.records[at - 1];
  if (rec === undefined) return 'absent';
  return rec.sequence === at ? rec.digest : 'unmeasured';
}

/** Every word this file quotes that the coordination directory's kebab census meets. */
export const isActHeadKebab = (word: string): boolean =>
  Object.hasOwn(ACT_HEAD_UNSIGNED_MAP, word) || word === 'recorded-today' || word === 'no-record';
