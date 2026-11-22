// Confirm the restore's transaction, the restore generation and `termRaised` (Overlord spec §7.6, §3.1, §4.3 C67; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` Tasks 8 and 9, questions 7, 13 and 17, rulings X3, F4,
// F5 and F8; review F10). Ring L4, context C5: the stateful reads and the one act, kept out of the L1 deciders
// (`overlordRestore.ts`). `index.ts` builds one `OverlordRestoreState` over the process's `coord.db`, the authority journal and its
// guard; the Confirm door (`overlordRoutes.ts`) calls `confirm`, the response stamp (`responses/stamp.ts`) reads
// `restoreGeneration()`, and the renewal readings read `termRaised()`.
//
// THE TRANSACTION (Task 8), on the coordination serialiser (the door's):
//   0. before it, an `unmeasured` guard is measured again (`remeasure`, its contract), and the torn-tail heal runs through its
//      owner (`healTornTail`, the kernel's rule), so a tail the boot would have healed is healed, never read as a cut;
//   1. inside one `tx()`, gather the facts (the guard, the verified file, the head row, the designation and ladder rows, and the
//      witness facts) and ask `confirmRestorePlan`; a refusal or "nothing waits" writes nothing;
//   2-3. `appendConfirmInTx`: a torn tail the heal refused, after records that reach the head row, is set aside first; then the
//      Confirm record is appended (ruling F5: before any table writes) and the head row moves to it;
//   4. each table writes its stricter value through its inner, unjournalled writer (X3): the designation's
//      (`applyDesignationRestoreInTx`) and the ladder's (`applyRestoreInTx`, with the record's sequence);
//   5. after the commit, `guard.confirmed()`, then the witness exchange offers the new tuple at once. The `restore-detected` latch
//      stands (F4): nothing here clears a latch.
// A throw after the append rolls the tables and the head row back and leaves the record trailing: the guard is told `trailing`,
// stays `rolled-back`, and the next Confirm folds the record in and counts its generation (review F14).
import type { DatabaseSync } from 'node:sqlite';
import { tx } from './tx.js';
import { authorityFold } from './overlordAuthority.js';
import { authorityCoherence, type AuthorityState } from './overlordAuthorityCoherence.js';
import type { OverlordAuthorityJournal } from './overlordAuthorityJournal.js';
import type { OverlordAuthorityGuard } from './overlordAuthorityGuard.js';
import {
  confirmRestorePlan, NARROWEST_RESTORE_SIDE,
  type ConfirmEpochRead, type ConfirmPrivacyRead, type ConfirmToldRead, type ConfirmWitnessRead, type RestoreSide, type TermRaised,
} from './overlordRestore.js';
import { applyDesignationRestoreInTx, designationRead } from './overlordDesignationStore.js';
import { applyRestoreInTx, ladderRows } from './overlordLadderStore.js';
import { rungRank, type Rung } from '../../../shared/overlord-ladder.js';
import { liveGenerations } from '../continuity/continuityStore.js';
import type { RecordedActor } from '../auth/callerIdentity.js';

/** What Confirm needs of the witness exchange (authority journal PR B): the server's epoch, the privacy head's sequence, the
 *  highest epoch and restore generation any witness answered with since boot, and the offer of the new tuple after a Confirm.
 *  L2, declared here by its consumer; PR B's exchange implements it, and until it lands `preWitnessFacts` stands in
 *  (`confirm-reads-the-witness-by-port`). */
export interface RestoreWitnessFacts {
  epoch(): ConfirmEpochRead;
  privacy(): ConfirmPrivacyRead;
  highest(): ConfirmWitnessRead;
  /** The narrowest told state over the counting witnesses that answered since boot (`null`: none has). */
  told(): ConfirmToldRead;
  /** After a Confirm commits: offer the new tuple to every witness at once. Never throws. */
  offerNow(): void;
}

/** The witness facts before the witness exchange exists (PR B): no witness has answered, so the highest is 0 and 0 (which only
 *  ever raises Confirm's bound, never proves one) and nothing was told; the privacy head is not wired (`absent`, question 11);
 *  and the server's epoch is question 7's formula over the authority journal's verified records alone, the last Confirm's
 *  `epochAtConfirm` plus the records after it (the sequence, with no Confirm). A torn tail is not a record, so it does not
 *  count (question 7: the heal never lowers the epoch); a malformed file reads `unmeasured`. PR B's `authorityEpoch` is the
 *  owner of that formula: whichever of PR B and this piece lands second replaces this adapter with PR B's in `index.ts`. */
export function preWitnessFacts(journal: Pick<OverlordAuthorityJournal, 'readVerified'>): RestoreWitnessFacts {
  return {
    epoch: () => {
      const f = journal.readVerified();
      if (f.kind === 'absent') return { kind: 'measured', n: 0 };
      if (f.kind !== 'records') return { kind: 'unmeasured', why: 'the authority journal cannot be folded' };
      const lc = authorityFold(f.records).lastConfirm;
      return { kind: 'measured', n: lc === null ? f.records.length : lc.epochAtConfirm + (f.records.length - lc.sequence) };
    },
    privacy: () => ({ kind: 'measured', sequence: null }),
    highest: () => ({ kind: 'measured', epoch: 0, restoreGeneration: 0 }),
    told: () => ({ kind: 'measured', told: null }),
    offerNow: () => { /* no witness exchange yet */ },
  };
}

export type ConfirmAnswer =
  | { readonly ok: true; readonly changed: false }
  | {
    readonly ok: true; readonly changed: true; readonly sequence: number; readonly term: number; readonly epochAtConfirm: number;
    readonly restoreGeneration: number; readonly newChain: boolean; readonly binding: 'kept' | 'cleared'; readonly owed: readonly string[];
  }
  /** `journal-unreadable`: a fact could not be read, or no bound on what the journal issued could be (nothing written; a torn tail
   *  Confirm set aside before a failed read stays aside, and the detail says so). `conflict`: the file moved under the plan.
   *  `journal-unwritable`: the tail's cut failed after it began (nothing appended), or the append or a table write failed and the
   *  record may stand trailing. Every detail is a fixed sentence with closed words, never an exception's text. */
  | { readonly ok: false; readonly refusal: 'journal-unreadable' | 'conflict' | 'journal-unwritable'; readonly detail: string };

/** The restore generation's accessor (Task 9; question 13): the last Confirm record's value, 0 with none, `unmeasured` (never 0)
 *  when the journal cannot be read, cannot be folded, or does not agree with its head row, or the guard is not coherent. */
export type RestoreGenerationRead = { readonly kind: 'measured'; readonly n: number } | { readonly kind: 'unmeasured'; readonly why: 'journal' };

export interface OverlordRestoreDeps {
  readonly db: DatabaseSync;
  readonly journal: Pick<OverlordAuthorityJournal, 'readVerified' | 'readRows' | 'appendConfirmInTx' | 'healTornTail'>;
  readonly guard: Pick<OverlordAuthorityGuard, 'state' | 'confirmed' | 'writerFailed' | 'remeasure'>;
  readonly witness: RestoreWitnessFacts;
}

/** The rows' side (the database's), read in the transaction: an absent designation row binds nothing at term 0, `opus`, the
 *  empty set; an absent ladder row reads `off` (ruling F8); each standing latch at its cap. */
function rowsSide(db: DatabaseSync): RestoreSide | { kind: 'unmeasured'; why: string } {
  const d = designationRead(db);
  if (d.kind === 'unmeasured') return { kind: 'unmeasured', why: d.why };
  const l = ladderRows(db);
  if (l.kind === 'unmeasured') return { kind: 'unmeasured', why: l.why };
  const caps = new Map<string, Rung>();
  for (const s of l.standing) {
    const had = caps.get(s.cause);
    caps.set(s.cause, had === undefined || rungRank(s.cap) < rungRank(had) ? s.cap : had);
  }
  const row = d.row;
  return {
    binding: row?.bound ?? null,
    term: row?.term ?? 0,
    operatorRung: l.rung === null ? NARROWEST_RESTORE_SIDE.operatorRung : l.rung.operatorRung,
    latches: [...caps].map(([cause, cap]) => ({ cause, cap })).sort((a, b) => (a.cause < b.cause ? -1 : 1)),
    accountSet: row === null ? NARROWEST_RESTORE_SIDE.accountSet : { pools: [...row.accountPools.pools], untagged: row.accountPools.untagged },
    modelClass: row === null ? NARROWEST_RESTORE_SIDE.modelClass : row.model,
  };
}

export class OverlordRestoreState {
  constructor(private readonly deps: OverlordRestoreDeps) {}

  /** Confirm the restore, as the operator the account gate passed with its step-up. Never throws. */
  confirm(actor: RecordedActor, opKey: string, at: number): ConfirmAnswer {
    const { db, journal, guard, witness } = this.deps;
    try {
      guard.remeasure();
      journal.healTornTail(db);
    } catch { /* the plan reads the file and the guard as they now stand */ }
    let appended: number | null = null;
    let answer: ConfirmAnswer;
    try {
      answer = tx(db, (): ConfirmAnswer => {
        const plan = confirmRestorePlan({
          guard: guard.state(), file: journal.readVerified(), rows: journal.readRows(db), dbSide: rowsSide(db),
          epoch: witness.epoch(), privacy: witness.privacy(), witnesses: witness.highest(), told: witness.told(), opKey,
        });
        if (plan.kind === 'refuse') return { ok: false, refusal: 'journal-unreadable', detail: plan.detail };
        if (plan.kind === 'unchanged') return { ok: true, changed: false };
        const a = journal.appendConfirmInTx(db, plan.entry, { cutTail: plan.cutTail, head: plan.expectHead });
        if (!a.ok) {
          const refusal = a.error === 'changed' ? 'conflict'
            : a.error === 'journal-append' || a.error === 'cut-failed' ? 'journal-unwritable' : 'journal-unreadable';
          return { ok: false, refusal, detail: a.detail };
        }
        appended = a.record.sequence;
        const s = plan.stricter;
        const { owed } = applyDesignationRestoreInTx(db, {
          binding: s.binding.kind === 'kept' ? { kind: 'kept', sessionId: s.binding.sessionId } : { kind: 'cleared' },
          pastIdsJoin: s.pastIdsJoin, term: s.term, model: s.modelClass, accountPools: s.accountSet,
        }, actor, at);
        applyRestoreInTx(db, { operatorRung: s.operatorRung, latches: s.latches }, a.record.sequence, at);
        return {
          ok: true, changed: true, sequence: a.record.sequence, term: s.term, epochAtConfirm: plan.entry.epochAtConfirm,
          restoreGeneration: plan.entry.restoreGeneration, newChain: plan.entry.newChain, binding: s.binding.kind, owed,
        };
      });
    } catch {
      // A throw before the append wrote nothing. One after it (a table writer, or the commit) leaves the record trailing with
      // its head row rolled back: the guard reads it so at once (`writer-failure-fences-trailing`).
      if (appended !== null) guard.writerFailed('trailing');
      return appended === null
        ? { ok: false, refusal: 'journal-unreadable', detail: 'a fact or a step before the append failed; no record was appended' }
        : { ok: false, refusal: 'journal-unwritable', detail: 'a table write or the commit failed after the append; the record may stand trailing' };
    }
    if (answer.ok && answer.changed) {
      guard.confirmed();
      try { witness.offerNow(); } catch { /* the exchange's next pass offers it */ }
    }
    return answer;
  }

  /** The restore generation now (Task 9): a fresh verified read, so no value outlives a write it did not see. */
  restoreGeneration(): RestoreGenerationRead {
    const { db, journal, guard } = this.deps;
    try {
      if (guard.state().kind !== 'coherent') return { kind: 'unmeasured', why: 'journal' };
      const file = journal.readVerified();
      if (authorityCoherence(file, journal.readRows(db)).kind !== 'coherent') return { kind: 'unmeasured', why: 'journal' };
      if (file.kind !== 'records') return { kind: 'measured', n: 0 };
      const lc = authorityFold(file.records).lastConfirm;
      return { kind: 'measured', n: lc === null ? 0 : lc.restoreGeneration };
    } catch {
      return { kind: 'unmeasured', why: 'journal' };
    }
  }

  /** The renewal readings' input (Task 8; the renewal readings piece wires it, so nothing calls it yet): `raised` when the designation's term is above the term its bound session's live
   *  `overlord` generation was stamped with, `not-raised` when equal or when nothing is bound (no generation to renew), and
   *  `unmeasured` when either read fails or the bound session has no live `overlord` generation yet (no term stamp). */
  termRaised(): TermRaised {
    const { db } = this.deps;
    const d = designationRead(db);
    if (d.kind === 'unmeasured') return 'unmeasured';
    if (d.kind === 'not-designated') return 'not-raised';
    const g = liveGenerations(db);
    if (!g.ok) return 'unmeasured';
    const gen = g.rows.find((r) => r.identity === 'overlord' && r.sessionId === d.sessionId);
    if (gen === undefined) return 'unmeasured';
    return d.term > gen.term ? 'raised' : 'not-raised';
  }

  /** The guard's state, for the door's answer and the banner's read: an `unmeasured` guard is measured again first (its
   *  `remeasure` contract), so a transient read error at boot clears without a restart. */
  authority(): AuthorityState {
    try { this.deps.guard.remeasure(); } catch { /* the state stands as it was */ }
    return this.deps.guard.state();
  }
}
