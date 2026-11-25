// Confirm the restore's deciders (Overlord spec §7.6, "Confirm the restore"; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` Task 8, questions 7, 13, 16 and 17, rulings X3, F4, F5
// and F8). Ring L1, context C5: no fs, no clock, no randomness. The L4 module `overlordRestoreState.ts` gathers the facts inside
// the door's one transaction, asks `confirmRestorePlan`, and acts; the journal (`overlordAuthorityJournal.ts#appendConfirmInTx`)
// appends the record this module builds; the designation's and the ladder's inner writers write its stricter values.
//
// `restoreStricter` is TABLE-DRIVEN (question 16, `confirm-rows-join-with-their-tables`): one row per authority field, each taking
// the database's value and the journal's and answering the stricter. Later waves add their rows with their tables: grants (W3,
// latched suspended), the reconciliation pass and the act ids (W2), classes (W3), the privacy journal's replay (W4), and the
// decision-model rows (`decision-rows-restore-after-c`).
//
// AN ABSENT SIDE READS AS THE NARROWEST VALUE PER FIELD (review F4, spec I11a): no binding, the lowest rung, no latch, the empty
// account set without `untagged`, `opus`, and term 0. An absent ladder row is such a side and reads `off` (ruling F8), never the
// ladder's default `chat`, which belongs to an ordinary read of a box that never had a row.
import { RUNGS, rungRank, type Rung } from '../../../shared/overlord-ladder.js';
import { chainedTailHealPlan, type ChainedPosition, type ChainedTailHealPlan } from '../chainedJournal.js';
import {
  authorityFold,
  type AuthorityView, type OverlordAccountSet, type OverlordAuthorityEntry, type OverlordAuthorityModelClass,
  type OverlordConfirmBinding, type OverlordLatchPair,
} from './overlordAuthority.js';
import { authorityCoherence, type AuthorityFileSeen, type AuthorityRowsSeen, type AuthorityState } from './overlordAuthorityCoherence.js';

/** One side of the restore, field by field: what the rows hold, or what the journal's fold says. */
export interface RestoreSide {
  readonly binding: { readonly sessionId: string; readonly generation: string } | null;
  readonly term: number;
  readonly operatorRung: Rung;
  /** Sorted by cause, one per cause. */
  readonly latches: readonly OverlordLatchPair[];
  readonly accountSet: OverlordAccountSet;
  readonly modelClass: OverlordAuthorityModelClass;
}

/** The narrowest value of every field: an absent side (review F4, question 17). */
export const NARROWEST_RESTORE_SIDE: RestoreSide = {
  binding: null, term: 0, operatorRung: RUNGS[0]!, latches: [], accountSet: { pools: [], untagged: false }, modelClass: 'opus',
};

/** The stricter of the two sides, as Confirm writes it and its record carries it. */
export interface RestoreStricter {
  readonly binding: OverlordConfirmBinding;
  /** The ids that join the designation's past ids: both sides' bound ids when the binding is cleared, none when kept. */
  readonly pastIdsJoin: readonly string[];
  readonly term: number;
  readonly operatorRung: Rung;
  readonly latches: readonly OverlordLatchPair[];
  readonly accountSet: OverlordAccountSet;
  readonly modelClass: OverlordAuthorityModelClass;
}

const byCause = (a: OverlordLatchPair, b: OverlordLatchPair): number => (a.cause < b.cause ? -1 : a.cause > b.cause ? 1 : 0);
const lower = (a: Rung, b: Rung): Rung => (rungRank(a) <= rungRank(b) ? a : b);

/** The journal's side, from its fold: a field no record named reads the narrowest value. */
export function journalSideOf(view: AuthorityView): RestoreSide {
  const d = view.designation;
  return {
    binding: d !== null && d.sessionId !== null && d.generation !== null ? { sessionId: d.sessionId, generation: d.generation } : null,
    term: d === null ? 0 : d.term,
    operatorRung: view.operatorRung ?? NARROWEST_RESTORE_SIDE.operatorRung,
    latches: [...view.latches].map(([cause, cap]) => ({ cause, cap })).sort(byCause),
    accountSet: view.accountSet ?? NARROWEST_RESTORE_SIDE.accountSet,
    modelClass: view.modelClass ?? NARROWEST_RESTORE_SIDE.modelClass,
  };
}

/** The stricter-of table (Task 8), one row per field:
 *
 * | Field | The stricter |
 * |---|---|
 * | the binding | the row's, when the journal's last designate, rebind or retire binds the same session; otherwise none, both ids join the past ids (§7.6) |
 * | `term` | the higher of the two, plus one (§3.1; never `designatedTerm`) |
 * | `operatorRung` | the lower rung (§7.5) |
 * | latches | the union, each cause at the lower cap (`restore-detected` is a row, so the union keeps it: F4) |
 * | the account set | the intersection; `untagged` only when both hold it (question 12) |
 * | the model class | `opus` unless both read `fable` (question 12) |
 */
export function restoreStricter(db: RestoreSide, journal: RestoreSide): RestoreStricter {
  const kept = db.binding !== null && journal.binding !== null && journal.binding.sessionId === db.binding.sessionId;
  const pastIdsJoin: string[] = [];
  if (!kept) {
    for (const b of [db.binding, journal.binding]) if (b !== null && !pastIdsJoin.includes(b.sessionId)) pastIdsJoin.push(b.sessionId);
  }
  const caps = new Map<string, Rung>();
  for (const l of [...db.latches, ...journal.latches]) {
    const had = caps.get(l.cause);
    caps.set(l.cause, had === undefined ? l.cap : lower(had, l.cap));
  }
  return {
    binding: kept ? { kind: 'kept', sessionId: db.binding!.sessionId, generation: db.binding!.generation } : { kind: 'cleared' },
    pastIdsJoin,
    term: Math.max(db.term, journal.term) + 1,
    operatorRung: lower(db.operatorRung, journal.operatorRung),
    latches: [...caps].map(([cause, cap]) => ({ cause, cap })).sort(byCause),
    accountSet: {
      pools: db.accountSet.pools.filter((p) => journal.accountSet.pools.includes(p)).sort(),
      untagged: db.accountSet.untagged && journal.accountSet.untagged,
    },
    modelClass: db.modelClass === 'fable' && journal.modelClass === 'fable' ? 'fable' : 'opus',
  };
}

/** `termRaised`'s words (the renewal readings' input, `overlordRestoreState.ts#termRaised`): the designation's term is above the
 *  term its bound generation was launched under, equal to it, or one of the two could not be read. A TOTAL table, for the
 *  coordination scanner (`overlordAuthorityJournal.ts#isOverlordAuthorityKebab`). */
export type TermRaised = 'raised' | 'not-raised' | 'unmeasured';
export const TERM_RAISED_WORDS: Readonly<Record<TermRaised, true>> = { raised: true, 'not-raised': true, unmeasured: true };

/** The told state folded into the stricter values: the lower rung, and each told latch joined at the lower cap. A told state
 *  only ever narrows (a narrowing a witness was told survives a restore that lost it); `null` changes nothing. */
export function toldNarrowed(s: RestoreStricter, told: { readonly operatorRung: Rung | null; readonly latches: readonly OverlordLatchPair[] } | null): RestoreStricter {
  if (told === null) return s;
  const caps = new Map<string, Rung>(s.latches.map((l) => [l.cause, l.cap]));
  for (const l of told.latches) {
    const had = caps.get(l.cause);
    caps.set(l.cause, had === undefined ? l.cap : lower(had, l.cap));
  }
  return {
    ...s,
    operatorRung: told.operatorRung === null ? s.operatorRung : lower(s.operatorRung, told.operatorRung),
    latches: [...caps].map(([cause, cap]) => ({ cause, cap })).sort(byCause),
  };
}

/** The server's epoch now (PR B's `authorityEpoch` total), read through the L4 module's port. */
export type ConfirmEpochRead = { readonly kind: 'measured'; readonly n: number } | { readonly kind: 'unmeasured'; readonly why: string };
/** The privacy journal's sequence now: `null` if unwired (`absent`, question 11) or wired but empty. */
export type ConfirmPrivacyRead = { readonly kind: 'measured'; readonly sequence: number | null } | { readonly kind: 'unmeasured'; readonly why: string };
/** The highest epoch and restore generation any witness answered with since boot; 0 and 0 when none has (question 13). It only
 *  raises Confirm's bound: it never proves that nothing higher was issued (`confirmRestorePlan`'s THE BOUND). */
export type ConfirmWitnessRead =
  | { readonly kind: 'measured'; readonly epoch: number; readonly restoreGeneration: number }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** The narrowing state a witness was told (PR B's tuple `told`, ruling `told-narrowings-survive-confirm`): the narrowest rung
 *  and latches over consistent or rollback-detecting off-volume sources from any boot, or `null` when none qualifies. */
export type ConfirmToldRead =
  | { readonly kind: 'measured'; readonly told: { readonly operatorRung: Rung | null; readonly latches: readonly OverlordLatchPair[] } | null }
  | { readonly kind: 'unmeasured'; readonly why: string };

/** Everything `confirmRestorePlan` reads, gathered in the door's one transaction. `dbSide` is the rows' side, or why it could
 *  not be read. */
export interface ConfirmFacts {
  readonly guard: AuthorityState;
  readonly file: AuthorityFileSeen<OverlordAuthorityEntry>;
  readonly rows: AuthorityRowsSeen;
  readonly dbSide: RestoreSide | { readonly kind: 'unmeasured'; readonly why: string };
  readonly epoch: ConfirmEpochRead;
  readonly privacy: ConfirmPrivacyRead;
  readonly witnesses: ConfirmWitnessRead;
  readonly told: ConfirmToldRead;
  readonly opKey: string;
}

export type ConfirmEntry = Extract<OverlordAuthorityEntry, { kind: 'authority-restore-confirmed' }>;

/** What the transaction does: refuse (and write nothing), nothing (nothing waits), or confirm. `cutTail` sets a torn tail aside
 *  first (the kernel's tail cut, over complete records that reach the head row); `expectHead` is the head the append must still
 *  find (null: an empty file, so the record is record 1). */
export type ConfirmPlan =
  | { readonly kind: 'refuse'; readonly detail: string }
  | { readonly kind: 'unchanged' }
  | {
    readonly kind: 'confirm'; readonly cutTail: ChainedTailHealPlan | null; readonly expectHead: ChainedPosition | null;
    readonly entry: ConfirmEntry; readonly stricter: RestoreStricter;
  };

const positionOf = (r: { sequence: number; journalId: string; digest: string }): ChainedPosition =>
  ({ sequence: r.sequence, journalId: r.journalId, digest: r.digest });
const samePosition = (a: ChainedPosition, b: ChainedPosition): boolean =>
  a.sequence === b.sequence && a.journalId === b.journalId && a.digest === b.digest;

/** The refusals' details: fixed sentences, each naming only what could not be read or bounded, never a read's own text. */
export const CONFIRM_REFUSED = {
  guard: 'the authority guard reads unmeasured',
  journal: 'the authority journal could not be read',
  head: 'the authority head row could not be read',
  rows: 'the authority rows could not be read',
  privacy: 'the privacy head could not be read',
  witnesses: 'the witnesses could not be read',
  told: 'the witnesses\' told state could not be read',
  epoch: 'the authority epoch could not be read',
  malformed: 'the authority journal is malformed, so no epoch or generation it issued is bounded; nothing was written',
  lost: 'the authority journal lacks records its head row attests, so no epoch or generation it issued is bounded; nothing was written',
} as const;

/**
 * Confirm the restore's plan (Task 8's transaction, step 1), first match. The door's state module runs the torn-tail heal
 * (`overlordAuthorityJournal.ts#healTornTail`, the kernel's rule) before it reads these facts.
 *
 * | # | the facts | plan |
 * |---|---|---|
 * | 1 | the guard reads `unmeasured`, or the file, the head row or the rows' side cannot be read | refuse |
 * | 2 | the guard reads `coherent` and the file is `coherent` against the head row | unchanged: nothing waits (a coherent guard over a trailing file waits, review F1) |
 * | 3 | the privacy head, the witnesses or their told state cannot be read | refuse |
 * | 4 | the file is `malformed` | refuse: no upper bound on what it issued (review 3334 F2) |
 * | 5 | the file's verified records do not reach the head row (`missing` with a head row, `behind`, `diverged`) | refuse: the records the head row attests are lost, and their values with them (review 3334 F1) |
 * | 6 | the server's epoch cannot be read | refuse |
 * | 7 | otherwise | confirm after the last verified record: a torn tail after it (one the heal refused) is set aside first; the journal side is the records' fold (a trailing record folded in), the epoch above the server's and every witness's, the generation above the journal's last and every witness's (question 13) |
 *
 * THE BOUND. Every value the journal issued is in its verified records when they reach the head row: the head row moves only
 * after its record's LF is durable, so nothing past the records was ever acknowledged, and a tail never was a record. A malformed
 * file, or one that lost records the head row attests, holds no such bound: its count of lines bounds its sequences, not the
 * epochs and generations its Confirm records carried, which Confirm itself sets above the sequence. A witness's highest only
 * raises the bound, never proves it (the stand-in's 0 and 0 least of all), so those refuse and write nothing, keeping every byte.
 * The residual of question 13 stands as it was: a whole-volume restore whose older journal agrees with its rows is bounded by
 * the witnesses that answered since boot.
 *
 * In a confirm, told state from a consistent or rollback-detecting off-volume source can narrow the stricter rung
 * and latches further (`toldNarrowed`), even if the source holds a tuple from this boot.
 */
export function confirmRestorePlan(f: ConfirmFacts): ConfirmPlan {
  if (f.guard.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.guard };
  if (f.file.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.journal };
  if (f.rows.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.head };
  if ('kind' in f.dbSide) return { kind: 'refuse', detail: CONFIRM_REFUSED.rows };
  const verdict = authorityCoherence(f.file, f.rows);
  if (f.guard.kind === 'coherent' && verdict.kind === 'coherent') return { kind: 'unchanged' };
  if (f.privacy.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.privacy };
  if (f.witnesses.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.witnesses };
  if (f.told.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.told };
  if (f.file.kind === 'malformed') return { kind: 'refuse', detail: CONFIRM_REFUSED.malformed };

  const records = f.file.kind === 'records' ? f.file.records : [];
  const head = f.rows.head;
  const atHead = head === null ? undefined : records[head.sequence - 1];
  if (head !== null && (atHead === undefined || !samePosition(atHead, head))) return { kind: 'refuse', detail: CONFIRM_REFUSED.lost };
  if (f.epoch.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.epoch };

  const view = authorityFold(records);
  const last = records[records.length - 1];
  const expectHead = last === undefined ? null : positionOf(last);
  const cutTail = f.file.kind === 'records' ? chainedTailHealPlan(f.file.tail, true) : null;
  const generationBase = view.lastConfirm === null ? 0 : view.lastConfirm.restoreGeneration;
  const stricter = toldNarrowed(restoreStricter(f.dbSide, journalSideOf(view)), f.told.told);
  return {
    kind: 'confirm', cutTail, expectHead, stricter,
    entry: {
      kind: 'authority-restore-confirmed', opKey: f.opKey, term: stricter.term,
      epochAtConfirm: Math.max(f.epoch.n, f.witnesses.epoch) + 1,
      privacySequenceAtConfirm: f.privacy.sequence,
      restoreGeneration: Math.max(generationBase, f.witnesses.restoreGeneration) + 1,
      newChain: expectHead === null,
      binding: stricter.binding, operatorRung: stricter.operatorRung, latches: stricter.latches,
      accountSet: stricter.accountSet, modelClass: stricter.modelClass,
    },
  };
}
