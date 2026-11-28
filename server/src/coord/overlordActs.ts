// The act row's deciders (Overlord spec §10.1, C25, H24, H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-rows.md`
// Tasks A2 and A3). Ring L1, context C5: pure, no node:* import, no fs, no SQL and no clock; the time is always an argument. The
// one writer, `./overlordActsStore.ts` (L3), reads the facts these ask for, asks them before any journal record, and writes what
// they answered.
//
// DECIDE BEFORE THE APPEND (§4.3; the coordinator's item 2 on act rows A). `actWriteVerdict` and `actSettleVerdict` answer every
// refusal from facts read inside the caller's `BEGIN IMMEDIATE`. Nothing refuses after the act journal's record: the store's apply
// re-asks the same decider and throws if it disagrees, a programming error, never a refusal. The throw undoes the apply's own
// savepoint only; the writer answers `journal-append`, and the caller's transaction is the door's to end
// (`overlordActsStore.ts#ActJournalPort`).
//
// THE ID IS ONE DECIDER'S (slug `act-id-from-one-decider`). `nextActId` answers the next id from the table's highest and the act
// journal's, never the table's own counter, so a refused or rolled-back write reserves nothing, and a restored floor is the
// journal's highest (act journal B), as the request record's `nextRequestId` does.
import { OVERLORD_ACT_KINDS, OVERLORD_ACT_KIND_LIST, actRow, type CeilingGroup, type OverlordActKind } from '../../../shared/overlord.js';
import {
  ACT_STATES, ACT_TARGET_KINDS, ACT_TARGET_REF_KINDS, ACT_MOVERS, actMoveAllowed, isActState,
  type ActAnswer, type ActMover, type ActState, type ActTarget, type ActTargetRef,
} from '../../../shared/overlordActs.js';
import type { CeilingVerdict } from './overlordActCeiling.js';

// -------------------------------------------------------------------------------------------------------------- the natural key

/** An act's natural key (§10.1, question 2): the act kind, the target's kind, its id and its revision, as one canonical text, with
 *  its three parts kept beside it for reads. A start is keyed by its request alone (F10): one start per request. */
export interface ActNaturalKey {
  readonly key: string; readonly kind: ActTarget['kind']; readonly id: number; readonly revision: number;
}
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** The key, or `null` for a target whose id or revision is not a non-negative safe integer. The text is a JSON array in a fixed
 *  order, so no key order of the input can change it. */
export function actNaturalKey(act: string, target: ActTarget): ActNaturalKey | null {
  if (target.kind === 'start') {
    if (!isCount(target.requestId)) return null;
    return { key: JSON.stringify(['start', target.requestId]), kind: 'start', id: target.requestId, revision: 0 };
  }
  if (!(ACT_TARGET_KINDS as readonly string[]).includes(target.kind) || !isCount(target.id) || !isCount(target.revision)) return null;
  return { key: JSON.stringify([act, target.kind, target.id, target.revision]), kind: target.kind, id: target.id, revision: target.revision };
}

// ------------------------------------------------------------------------------------------------------------------------- the id

/** The next act id: one past the larger of the table's highest and the act journal's (`null` until act journal B supplies it). */
export function nextActId(storeHighest: number | null, journalHighest: number | null): number {
  return Math.max(storeHighest ?? 0, journalHighest ?? 0) + 1;
}

// -------------------------------------------------------------------------------------------------------------------- the counts

/** The act kinds a group counts: every catalogue kind whose ceiling is counted in it. A row counts in a group when its kind OR
 *  its effect is one of these (F6). */
export function groupKinds(group: CeilingGroup): readonly OverlordActKind[] {
  return OVERLORD_ACT_KIND_LIST.filter((k) => { const c = OVERLORD_ACT_KINDS[k].ceiling; return c.kind === 'counted' && c.group === group; });
}
/** The groups the writer's ceiling re-check reads (F6): the act's own, when counted, and its effect's, when the effect is a
 *  counted kind. Both are asked, as the door that gathers the effect's verdict asks them (call 1874). */
export function writeCountGroups(act: OverlordActKind, effect: string | null): { readonly act: CeilingGroup | null; readonly effect: CeilingGroup | null } {
  const own = OVERLORD_ACT_KINDS[act].ceiling;
  const theirs = effect === null ? undefined : actRow(effect)?.ceiling;
  return { act: own.kind === 'counted' ? own.group : null, effect: theirs !== undefined && theirs.kind === 'counted' ? theirs.group : null };
}

// ----------------------------------------------------------------------------------------------------------------- the records

/** The natural key as the act journal's grammar carries it (the act journal plan's Table 1). */
export type ActRecordNatural =
  | { readonly kind: 'row'; readonly target: string; readonly id: number; readonly revision: number }
  | { readonly kind: 'start'; readonly requestId: number };
/** What `act-intent` and `act-settle` both carry: ids, kinds and states only, never the Overlord's words. */
export interface ActRecordBody {
  readonly opKey: string; readonly actId: number; readonly act: string; readonly effect: string | null;
  readonly natural: ActRecordNatural; readonly targets: readonly ActTargetRef[]; readonly requestId: number | null;
  readonly authority: string; readonly term: number; readonly generationId: number;
  readonly actor: { readonly kind: string; readonly subject: string }; readonly identityStrength: string; readonly isolation: string;
}
/** The one record type (F7). The act journal's grammar validates it and names it `OverlordActRecord`, an alias, never a second
 *  shape. A one-step act appends one `act-settle` with `from: null`; a two-step act `act-intent` and later its `act-settle`. */
export type ActJournalRecord =
  | ({ readonly kind: 'act-intent' } & ActRecordBody)
  | ({ readonly kind: 'act-settle'; readonly from: 'pending' | 'unknown' | null; readonly to: ActState } & ActRecordBody)
  | { readonly kind: 'act-open-request'; readonly opKey: string; readonly requestId: number; readonly actId: number };
const ACT_RECORD_KIND_MAP: Record<ActJournalRecord['kind'], true> = { 'act-intent': true, 'act-settle': true, 'act-open-request': true };

export function recordNatural(n: ActNaturalKey): ActRecordNatural {
  return n.kind === 'start' ? { kind: 'start', requestId: n.id } : { kind: 'row', target: n.kind, id: n.id, revision: n.revision };
}
/** Targets in one order (kind, then id, then revision), as the grammar's canonical form wants them. */
export function sortedTargets(targets: readonly ActTargetRef[]): readonly ActTargetRef[] {
  return [...targets].sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision));
}

/** The records a write appends (§4.3): `act-settle` from `null` for `done`, `act-intent` for `pending`, then `act-open-request`
 *  when the write opens a request. */
export function writeRecords(body: ActRecordBody, state: 'pending' | 'done', opens: number | null): readonly ActJournalRecord[] {
  const first: ActJournalRecord = state === 'done' ? { kind: 'act-settle', from: null, to: 'done', ...body } : { kind: 'act-intent', ...body };
  return opens === null ? [first] : [first, { kind: 'act-open-request', opKey: body.opKey, requestId: opens, actId: body.actId }];
}

// ------------------------------------------------------------------------------------------------------------------- the write

/** The writer's answers (the plan's `ActWritten`). The four allow words are DECLARED AND UNREACHABLE in this part (slug
 *  `allow-words-declared-unreachable`): the allow is a structural type here, and the may-act decider's part adds their arms. */
const ACT_WRITE_REFUSAL_MAP = {
  'not-in-transaction': 'the write runs only inside the transaction that holds its row',
  'bad-row': 'a state no door enters, a target with no key, or a field out of shape',
  'op-key-taken': 'the operation key already names an act of this session and generation; the holder is the replay',
  'natural-key-taken': 'another act not settled refused holds this natural key',
  'act-ceiling': "the act's group, or its effect's, is at its ceiling",
  unmeasured: 'a key or a count the write needs could not be read',
  'allow-forged': 'the allow was not minted by the decider (unreachable in this part)',
  'allow-spent': 'the allow was used before (unreachable in this part)',
  'allow-mismatch': "the allow's facts differ from the row (unreachable in this part)",
  'cell-not-built': "the allow's cell writes a row this build lacks (unreachable in this part)",
  'authority-rolled-back': "the journal's port answered it",
  'authority-unmeasured': "the journal's port answered it",
  'journal-append': "the journal's port answered it",
} as const;
export type ActWriteRefusal = keyof typeof ACT_WRITE_REFUSAL_MAP;

/** What the write decides from: every fact read inside the transaction before any record. */
export interface ActWriteFacts {
  readonly inTransaction: boolean;
  readonly state: string;
  readonly natural: ActNaturalKey | null;
  /** The store's shape check of the input: `null` when every field is in shape, else the field. */
  readonly fault: string | null;
  readonly opKeyHolder: ActAnswer | null | { readonly unmeasured: string };
  readonly naturalKeyHolder: ActAnswer | null | { readonly unmeasured: string };
  readonly ceiling: CeilingVerdict;
}
export type ActWriteVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: 'not-in-transaction' | 'bad-row' | 'unmeasured'; readonly detail: string }
  | { readonly ok: false; readonly error: 'op-key-taken' | 'natural-key-taken'; readonly detail: string; readonly holder: ActAnswer }
  | { readonly ok: false; readonly error: 'act-ceiling'; readonly detail: string; readonly group: CeilingGroup };

const isUnmeasured = (h: ActWriteFacts['opKeyHolder']): h is { readonly unmeasured: string } => h !== null && 'unmeasured' in h;

/** First match: the transaction; the row's shape (a state the door enters from nothing, a target with a key, the fields); the
 *  operation key (a holder is the replay, so it is read before the natural key it also holds); the natural key; then the
 *  ceilings of the act's group and the effect's (an `unavailable` count is `unmeasured`, never a pass). */
export function actWriteVerdict(f: ActWriteFacts): ActWriteVerdict {
  if (!f.inTransaction) return { ok: false, error: 'not-in-transaction', detail: 'an act is written only inside the transaction that holds its row' };
  if (!isActState(f.state) || !actMoveAllowed(null, f.state, 'door')) return { ok: false, error: 'bad-row', detail: `state ${f.state}` };
  if (f.natural === null) return { ok: false, error: 'bad-row', detail: 'target' };
  if (f.fault !== null) return { ok: false, error: 'bad-row', detail: f.fault };
  if (isUnmeasured(f.opKeyHolder)) return { ok: false, error: 'unmeasured', detail: `operation key: ${f.opKeyHolder.unmeasured}` };
  if (f.opKeyHolder !== null) return { ok: false, error: 'op-key-taken', detail: `act ${f.opKeyHolder.id}`, holder: f.opKeyHolder };
  if (isUnmeasured(f.naturalKeyHolder)) return { ok: false, error: 'unmeasured', detail: `natural key: ${f.naturalKeyHolder.unmeasured}` };
  if (f.naturalKeyHolder !== null) return { ok: false, error: 'natural-key-taken', detail: `act ${f.naturalKeyHolder.id}`, holder: f.naturalKeyHolder };
  if (!f.ceiling.pass) {
    return f.ceiling.word === 'act-ceiling'
      ? { ok: false, error: 'act-ceiling', detail: `${f.ceiling.group} ${f.ceiling.scope} ${f.ceiling.limit}`, group: f.ceiling.group }
      : { ok: false, error: 'unmeasured', detail: `count ${f.ceiling.group}: ${f.ceiling.why}` };
  }
  return { ok: true };
}

// ------------------------------------------------------------------------------------------------------------------ the settle

const ACT_SETTLE_REFUSAL_MAP = {
  'not-in-transaction': 'the settle runs only inside the transaction that holds its row',
  'not-found': 'no act row has this id',
  'bad-row': 'the move is not a row of ACT_TRANSITIONS for this mover',
} as const;
export type ActSettleRefusal = keyof typeof ACT_SETTLE_REFUSAL_MAP;
export type ActSettleVerdict =
  | { readonly ok: true; readonly from: 'pending' | 'unknown' }
  | { readonly ok: false; readonly error: ActSettleRefusal; readonly detail: string };

/** The second step's and the lane's settle (§4.3): the stored state, read in this transaction, must be a `from` of a row that
 *  lets `by` reach `to`. A stored word this build lacks moves nowhere. */
export function actSettleVerdict(f: { readonly inTransaction: boolean; readonly stored: string | 'absent'; readonly to: string; readonly by: ActMover }): ActSettleVerdict {
  if (!f.inTransaction) return { ok: false, error: 'not-in-transaction', detail: 'an act is settled only inside the transaction that holds its row' };
  if (f.stored === 'absent') return { ok: false, error: 'not-found', detail: 'no row' };
  if (!isActState(f.stored) || !isActState(f.to) || !actMoveAllowed(f.stored, f.to, f.by)) {
    return { ok: false, error: 'bad-row', detail: `${f.stored} -> ${f.to} by ${f.by}` };
  }
  return f.stored === 'pending' || f.stored === 'unknown' ? { ok: true, from: f.stored }
    : { ok: false, error: 'bad-row', detail: `${f.stored} -> ${f.to} by ${f.by}` };
}

// ------------------------------------------------------------------------------------------------------------------- the words

/** Every word the act files quote: L0's states, movers and target kinds, and this module's record kinds and refusals. Derived
 *  from those lists, so the coordination directory's kebab-token census admits a word only from its one declared home. */
export const isActKebab = (word: string): boolean =>
  (ACT_STATES as readonly string[]).includes(word) || (ACT_MOVERS as readonly string[]).includes(word)
  || (ACT_TARGET_KINDS as readonly string[]).includes(word) || (ACT_TARGET_REF_KINDS as readonly string[]).includes(word)
  || word === 'start' || Object.hasOwn(ACT_RECORD_KIND_MAP, word) || Object.hasOwn(ACT_WRITE_REFUSAL_MAP, word)
  || Object.hasOwn(ACT_SETTLE_REFUSAL_MAP, word);
