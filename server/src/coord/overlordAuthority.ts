// The Overlord authority journal's grammar, its format on the chained kernel, and the fold of its records (Overlord spec §7.6,
// H27; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md` Task 3, questions 2, 12 and 17, rulings X2
// and F5). Ring L1, context C5: no fs, no clock, no randomness. The writer that appends these records is
// `overlordAuthorityJournal.ts` (L3); boot coherence is `overlordAuthorityCoherence.ts` (L1).
//
// Every name here starts with the Overlord, so neither a reader nor a grep confuses it with the landing line's "landing authority
// journal" (`overlord-authority-names`). The grammar is closed, with exact keys and every value checked, in the delegation
// grammar's shape. A generation is a string, the UUID ccd records, never a number (X2). A record holds no operator words and no
// secret, and no actor: every W1 kind is an operator door's (`goLive` completes the operator's designate or rebind act), and the
// rows keep actors (§7.4).
//
// The vocabularies the grammar checks: the rung words are the ladder's L0 owner's (`shared/overlord-ladder.ts#RUNGS`), re-pointed in
// the ladder's pull request; a pool name is `shared/roster.ts#POOL_NAME_RE`; a model class is the two of `shared/models.ts#CLASSES`
// the designate door may choose. A latch's CAUSE is checked by shape only (the ladder's `LADDER_CAUSE_KEY_RE`), never against a
// closed list: a latch row whose cause this build does not know still caps the rung (the ladder plan, question 16), so a record a
// newer build wrote must still read here (`latch-cause-checked-by-shape`).
import { LADDER_CAUSE_MAX, LADDER_CAUSE_KEY_RE, RUNGS, type Rung } from '../../../shared/overlord-ladder.js';
import { POOL_NAME_RE } from '../../../shared/roster.js';
import type { ModelClass } from '../../../shared/models.js';
import {
  chainedExactKeys, isRecord,
  type ChainedJournalErrorCode, type ChainedJournalFormat, type ChainedJournalRecord, type JournalWhere,
} from '../chainedJournal.js';

/** The journal file in `~/.ccrc`, and its quarantine directory (one path component inside it, A0's `aside-dir-is-a-child-name`).
 *  Neither is ever in a snapshot, a backup set or a restore pair, like the landing line's `landing.log`. */
export const OVERLORD_AUTHORITY_BASENAME = 'overlord-authority.jsonl';
export const OVERLORD_AUTHORITY_TORN_DIR = 'overlord-authority-torn';

// ── The vocabularies ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The ladder's rungs, lowest first (§7.5, H25): the ladder's own list, re-pointed here in its pull request. */
export const OVERLORD_AUTHORITY_RUNGS: readonly Rung[] = RUNGS;
export type OverlordRungWord = Rung;
/** A latch cause's shape: the ladder's (`LADDER_CAUSE_KEY_RE`, at most `LADDER_CAUSE_MAX` bytes). */
const CAUSE_RE = LADDER_CAUSE_KEY_RE;
const CAUSE_MAX = LADDER_CAUSE_MAX;
/** The model classes an Overlord body may run on (C46): `opus` is the stricter. */
export const OVERLORD_AUTHORITY_MODEL_CLASSES = ['opus', 'fable'] as const satisfies readonly ModelClass[];
export type OverlordAuthorityModelClass = (typeof OVERLORD_AUTHORITY_MODEL_CLASSES)[number];
/** An opaque token (an operation key, a session id, a generation): printable ASCII with no space, at most 128 bytes. */
const TOKEN_RE = /^[\x21-\x7e]{1,128}$/;

export interface OverlordAccountSet { pools: readonly string[]; untagged: boolean }
export interface OverlordLatchPair { cause: string; cap: OverlordRungWord }
export type OverlordConfirmBinding = { kind: 'kept'; sessionId: string; generation: string } | { kind: 'cleared' };

// ── The entries ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type OverlordAuthorityEntry =
  | { kind: 'authority-designate'; opKey: string; term: number; sessionId: string; generation: string }
  | { kind: 'authority-rebind'; opKey: string; term: number; sessionId: string; generation: string; previousSessionId: string }
  | { kind: 'authority-retire'; opKey: string; term: number; previousSessionId: string }
  | { kind: 'authority-rung'; opKey: string; from: OverlordRungWord; to: OverlordRungWord }
  | { kind: 'authority-latch-raise'; opKey: string; cause: string; cap: OverlordRungWord }
  | { kind: 'authority-latch-clear'; opKey: string; cause: string }
  | { kind: 'authority-account-set'; opKey: string; from: OverlordAccountSet; to: OverlordAccountSet }
  | { kind: 'authority-model-class'; opKey: string; from: OverlordAuthorityModelClass; to: OverlordAuthorityModelClass }
  | {
    kind: 'authority-restore-confirmed'; opKey: string; term: number; epochAtConfirm: number;
    privacySequenceAtConfirm: number | null; restoreGeneration: number; newChain: boolean;
    binding: OverlordConfirmBinding; operatorRung: OverlordRungWord; latches: readonly OverlordLatchPair[];
    accountSet: OverlordAccountSet; modelClass: OverlordAuthorityModelClass;
  };
export type OverlordAuthorityKind = OverlordAuthorityEntry['kind'];
/** Every entry but the Confirm record: what `appendInTx` takes and `authorityDirection` reads. */
export type OverlordAuthorityMove = Exclude<OverlordAuthorityEntry, { kind: 'authority-restore-confirmed' }>;

type EntryOf<K extends OverlordAuthorityKind> = Extract<OverlordAuthorityEntry, { kind: K }>;
const keysOf = <T>(table: Readonly<Record<keyof T, true>>): readonly string[] => Object.keys(table);

/** Each kind's exact keys, as TOTAL tables over its entry type, so a field added to a kind is a compile error here until named. */
const KEYS: { readonly [K in OverlordAuthorityKind]: readonly string[] } = {
  'authority-designate': keysOf<EntryOf<'authority-designate'>>({ kind: true, opKey: true, term: true, sessionId: true, generation: true }),
  'authority-rebind': keysOf<EntryOf<'authority-rebind'>>({
    kind: true, opKey: true, term: true, sessionId: true, generation: true, previousSessionId: true,
  }),
  'authority-retire': keysOf<EntryOf<'authority-retire'>>({ kind: true, opKey: true, term: true, previousSessionId: true }),
  'authority-rung': keysOf<EntryOf<'authority-rung'>>({ kind: true, opKey: true, from: true, to: true }),
  'authority-latch-raise': keysOf<EntryOf<'authority-latch-raise'>>({ kind: true, opKey: true, cause: true, cap: true }),
  'authority-latch-clear': keysOf<EntryOf<'authority-latch-clear'>>({ kind: true, opKey: true, cause: true }),
  'authority-account-set': keysOf<EntryOf<'authority-account-set'>>({ kind: true, opKey: true, from: true, to: true }),
  'authority-model-class': keysOf<EntryOf<'authority-model-class'>>({ kind: true, opKey: true, from: true, to: true }),
  'authority-restore-confirmed': keysOf<EntryOf<'authority-restore-confirmed'>>({
    kind: true, opKey: true, term: true, epochAtConfirm: true, privacySequenceAtConfirm: true, restoreGeneration: true,
    newChain: true, binding: true, operatorRung: true, latches: true, accountSet: true, modelClass: true,
  }),
};

/** Every entry kind, as a TOTAL table over the union. */
export const OVERLORD_AUTHORITY_KINDS: Readonly<Record<OverlordAuthorityKind, true>> = {
  'authority-designate': true, 'authority-rebind': true, 'authority-retire': true, 'authority-rung': true,
  'authority-latch-raise': true, 'authority-latch-clear': true, 'authority-account-set': true, 'authority-model-class': true,
  'authority-restore-confirmed': true,
};

const ACCOUNT_SET_KEYS = keysOf<OverlordAccountSet>({ pools: true, untagged: true });
const LATCH_KEYS = keysOf<OverlordLatchPair>({ cause: true, cap: true });
const KEPT_KEYS = keysOf<Extract<OverlordConfirmBinding, { kind: 'kept' }>>({ kind: true, sessionId: true, generation: true });
const CLEARED_KEYS = keysOf<Extract<OverlordConfirmBinding, { kind: 'cleared' }>>({ kind: true });

// ── The refusal classes and the format ───────────────────────────────────────────────────────────────────────────────

export type OverlordAuthorityErrorCode = ChainedJournalErrorCode;

/** Every refusal of the grammar and the kernel over this journal. `code` is the kernel's word. */
export class OverlordAuthorityError extends Error {
  constructor(readonly code: OverlordAuthorityErrorCode, detail: string, readonly where?: JournalWhere) {
    super(`overlord authority journal ${code}: ${detail}${where?.line !== undefined ? ` (line ${where.line})` : ''}`);
    this.name = 'OverlordAuthorityError';
  }
}
/** The canonical writer's refusal (a value outside the canonical JSON domain), its own class as every format's is. */
export class OverlordAuthorityJsonError extends Error {
  constructor(detail: string) {
    super(`overlord authority canonical JSON: ${detail}`);
    this.name = 'OverlordAuthorityJsonError';
  }
}

function refuse(code: OverlordAuthorityErrorCode, detail: string): never {
  throw new OverlordAuthorityError(code, detail);
}

/** The Overlord authority journal as a chained-journal format, for the writer and the kinds census. */
export const OVERLORD_AUTHORITY_FORMAT: ChainedJournalFormat<OverlordAuthorityEntry, OverlordAuthorityError> = {
  kinds: Object.keys(OVERLORD_AUTHORITY_KINDS),
  entry: (raw) => authorityEntry(raw),
  fail: (code, detail, where) => new OverlordAuthorityError(code, detail, where),
  jsonError: (detail) => new OverlordAuthorityJsonError(detail),
};

// ── The field checks ─────────────────────────────────────────────────────────────────────────────────────────────────

const exactKeys = (o: Record<string, unknown>, keys: readonly string[], what: string): void =>
  chainedExactKeys(OVERLORD_AUTHORITY_FORMAT, o, keys, what);
const token = (v: unknown, what: string): string =>
  typeof v === 'string' && TOKEN_RE.test(v) ? v : refuse('bad-field', `${what} is not a token (printable, no space, 1 to 128 bytes)`);
const positiveInt = (v: unknown, what: string): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 ? v : refuse('bad-field', `${what} is not a positive safe integer`);
const countInt = (v: unknown, what: string): number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : refuse('bad-field', `${what} is not a non-negative safe integer`);
const bool = (v: unknown, what: string): boolean => (typeof v === 'boolean' ? v : refuse('bad-field', `${what} is not a boolean`));
function member<T extends string>(list: readonly T[], v: unknown, what: string): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : refuse('bad-field', `${what} is not one of ${list.join(', ')}`);
}
const rung = (v: unknown, what: string): OverlordRungWord => member(OVERLORD_AUTHORITY_RUNGS, v, what);
const modelClass = (v: unknown, what: string): OverlordAuthorityModelClass => member(OVERLORD_AUTHORITY_MODEL_CLASSES, v, what);
const cause = (v: unknown, what: string): string =>
  typeof v === 'string' && v.length <= CAUSE_MAX && CAUSE_RE.test(v) ? v : refuse('bad-field', `${what} is not a kebab cause word`);

function accountSet(v: unknown, what: string): OverlordAccountSet {
  if (!isRecord(v)) return refuse('bad-field', `${what} is not an object`);
  exactKeys(v, ACCOUNT_SET_KEYS, what);
  const pools = v['pools'];
  if (!Array.isArray(pools)) return refuse('bad-field', `${what}.pools is not an array`);
  const out: string[] = [];
  for (const p of pools) {
    if (typeof p !== 'string' || !POOL_NAME_RE.test(p)) return refuse('bad-field', `${what}.pools holds a value that is not a pool name`);
    if (out.length > 0 && !(out[out.length - 1]! < p)) return refuse('bad-field', `${what}.pools is not sorted and unique`);
    out.push(p);
  }
  return { pools: out, untagged: bool(v['untagged'], `${what}.untagged`) };
}

function latches(v: unknown): OverlordLatchPair[] {
  if (!Array.isArray(v)) return refuse('bad-field', 'latches is not an array');
  const out: OverlordLatchPair[] = [];
  for (const l of v) {
    if (!isRecord(l)) return refuse('bad-field', 'latches holds a value that is not a {cause, cap} pair');
    exactKeys(l, LATCH_KEYS, 'a latch');
    const pair = { cause: cause(l['cause'], 'latch cause'), cap: rung(l['cap'], 'latch cap') };
    if (out.length > 0 && !(out[out.length - 1]!.cause < pair.cause)) return refuse('bad-field', 'latches are not sorted by cause, one per cause');
    out.push(pair);
  }
  return out;
}

function binding(v: unknown): OverlordConfirmBinding {
  if (!isRecord(v)) return refuse('bad-field', 'binding is not an object');
  if (v['kind'] === 'cleared') { exactKeys(v, CLEARED_KEYS, 'a cleared binding'); return { kind: 'cleared' }; }
  if (v['kind'] !== 'kept') return refuse('bad-field', 'binding.kind is neither kept nor cleared');
  exactKeys(v, KEPT_KEYS, 'a kept binding');
  return { kind: 'kept', sessionId: token(v['sessionId'], 'binding.sessionId'), generation: token(v['generation'], 'binding.generation') };
}

/** One entry rebuilt field by field, or an `OverlordAuthorityError`. A kind of another journal is refused naming the kind. */
export function authorityEntry(raw: unknown): OverlordAuthorityEntry {
  if (!isRecord(raw)) return refuse('bad-field', 'the entry is not an object');
  const k = raw['kind'];
  if (typeof k !== 'string' || !Object.hasOwn(OVERLORD_AUTHORITY_KINDS, k)) {
    return refuse('bad-field', `the entry kind ${JSON.stringify(k)} is not an Overlord authority kind`);
  }
  const kind = k as OverlordAuthorityKind;
  exactKeys(raw, KEYS[kind], `an ${kind} entry`);
  const opKey = token(raw['opKey'], 'opKey');
  switch (kind) {
    case 'authority-designate':
      return { kind, opKey, term: positiveInt(raw['term'], 'term'), sessionId: token(raw['sessionId'], 'sessionId'), generation: token(raw['generation'], 'generation') };
    case 'authority-rebind':
      return {
        kind, opKey, term: positiveInt(raw['term'], 'term'), sessionId: token(raw['sessionId'], 'sessionId'),
        generation: token(raw['generation'], 'generation'), previousSessionId: token(raw['previousSessionId'], 'previousSessionId'),
      };
    case 'authority-retire':
      return { kind, opKey, term: positiveInt(raw['term'], 'term'), previousSessionId: token(raw['previousSessionId'], 'previousSessionId') };
    case 'authority-rung':
      return { kind, opKey, from: rung(raw['from'], 'from'), to: rung(raw['to'], 'to') };
    case 'authority-latch-raise':
      return { kind, opKey, cause: cause(raw['cause'], 'cause'), cap: rung(raw['cap'], 'cap') };
    case 'authority-latch-clear':
      return { kind, opKey, cause: cause(raw['cause'], 'cause') };
    case 'authority-account-set':
      return { kind, opKey, from: accountSet(raw['from'], 'from'), to: accountSet(raw['to'], 'to') };
    case 'authority-model-class':
      return { kind, opKey, from: modelClass(raw['from'], 'from'), to: modelClass(raw['to'], 'to') };
    case 'authority-restore-confirmed': {
      const p = raw['privacySequenceAtConfirm'];
      return {
        kind, opKey, term: positiveInt(raw['term'], 'term'), epochAtConfirm: countInt(raw['epochAtConfirm'], 'epochAtConfirm'),
        privacySequenceAtConfirm: p === null ? null : countInt(p, 'privacySequenceAtConfirm'),
        restoreGeneration: positiveInt(raw['restoreGeneration'], 'restoreGeneration'), newChain: bool(raw['newChain'], 'newChain'),
        binding: binding(raw['binding']), operatorRung: rung(raw['operatorRung'], 'operatorRung'), latches: latches(raw['latches']),
        accountSet: accountSet(raw['accountSet'], 'accountSet'), modelClass: modelClass(raw['modelClass'], 'modelClass'),
      };
    }
  }
}

// ── Which way a move goes ────────────────────────────────────────────────────────────────────────────────────────────

const rank = (r: OverlordRungWord): number => OVERLORD_AUTHORITY_RUNGS.indexOf(r);
/** `to` within `from`: every pool of `to` is in `from`, and `to` takes untagged accounts only when `from` did. */
const within = (to: OverlordAccountSet, from: OverlordAccountSet): boolean =>
  to.pools.every((p) => from.pools.includes(p)) && (!to.untagged || from.untagged);

/** Which way an entry moves authority, from the entry alone: over an incoherent journal no fold can be trusted to say. A rung
 *  to the same rung, or an account set to itself, grants nothing new and reads `narrows`; a model-class record reads `widens`
 *  whenever its `to` is `fable`, `fable` to `fable` included (the plan's table, the conservative side). The Confirm record is
 *  neither, and never reaches here. */
export function authorityDirection(entry: OverlordAuthorityMove): 'narrows' | 'widens' {
  switch (entry.kind) {
    case 'authority-designate': case 'authority-rebind': case 'authority-latch-clear': return 'widens';
    case 'authority-retire': case 'authority-latch-raise': return 'narrows';
    case 'authority-rung': return rank(entry.to) > rank(entry.from) ? 'widens' : 'narrows';
    case 'authority-account-set': return within(entry.to, entry.from) ? 'narrows' : 'widens';
    case 'authority-model-class': return entry.to === 'fable' ? 'widens' : 'narrows';
  }
}

/** An account-set move's two pool lists sorted and de-duplicated, before the grammar reads them (`the-writer-canonicalises`):
 *  the designation door keeps the operator's order in its row, and a reorder is no change of membership, so an operator
 *  narrowing is never refused for order alone. Anything else, or a list that is not all strings, is returned as it came, for
 *  the grammar to judge. */
export function canonicalAuthorityMove(raw: unknown): unknown {
  if (!isRecord(raw) || raw['kind'] !== 'authority-account-set') return raw;
  const sortedPools = (v: unknown): unknown => {
    if (!isRecord(v) || !Array.isArray(v['pools']) || !v['pools'].every((p) => typeof p === 'string')) return v;
    return { ...v, pools: [...new Set(v['pools'] as string[])].sort() };
  };
  return { ...raw, from: sortedPools(raw['from']), to: sortedPools(raw['to']) };
}

/** A move's stated `from` held against the journal's fold, while the journal is coherent (`stated-from-against-the-fold`):
 *  `null` when the move states no `from` or the fold holds no value for its field yet (no record named it), so the stated
 *  `from` stands; otherwise whether it equals the fold's value, and the move's direction from the fold's value to its `to`. */
export function authorityAgainstFold(
  move: OverlordAuthorityMove, view: AuthorityView,
): { matches: boolean; direction: 'narrows' | 'widens' } | null {
  switch (move.kind) {
    case 'authority-rung':
      return view.operatorRung === null ? null
        : { matches: view.operatorRung === move.from, direction: authorityDirection({ ...move, from: view.operatorRung }) };
    case 'authority-model-class':
      return view.modelClass === null ? null
        : { matches: view.modelClass === move.from, direction: authorityDirection({ ...move, from: view.modelClass }) };
    case 'authority-account-set': {
      const f = view.accountSet;
      if (f === null) return null;
      const same = f.untagged === move.from.untagged && f.pools.length === move.from.pools.length
        && f.pools.every((p, i) => p === move.from.pools[i]);
      return { matches: same, direction: authorityDirection({ ...move, from: f }) };
    }
    default: return null;
  }
}

// ── The fold ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The journal's view of authority: what the records, folded in order, say each field is, and the last Confirm. A field no
 *  record named is `null`; `latches` maps each standing cause to its cap (F5). */
export interface AuthorityView {
  designation: { term: number; sessionId: string | null; generation: string | null } | null;
  operatorRung: OverlordRungWord | null;
  latches: ReadonlyMap<string, OverlordRungWord>;
  accountSet: OverlordAccountSet | null;
  modelClass: OverlordAuthorityModelClass | null;
  lastConfirm: { sequence: number; epochAtConfirm: number; privacySequenceAtConfirm: number | null; restoreGeneration: number } | null;
}

/** The records folded in order. A designate or rebind binds its session; a retire leaves no binding and its term. A latch raised
 *  twice keeps the lower cap (a new latch never raises the cap, §7.5). A Confirm sets every field to the stricter value it
 *  carries, so a widening before it is gone. */
export function authorityFold(records: readonly ChainedJournalRecord<OverlordAuthorityEntry>[]): AuthorityView {
  const v: AuthorityView = { designation: null, operatorRung: null, latches: new Map(), accountSet: null, modelClass: null, lastConfirm: null };
  const latchMap = new Map<string, OverlordRungWord>();
  for (const r of records) {
    const e = r.entry;
    switch (e.kind) {
      case 'authority-designate': case 'authority-rebind':
        v.designation = { term: e.term, sessionId: e.sessionId, generation: e.generation }; break;
      case 'authority-retire': v.designation = { term: e.term, sessionId: null, generation: null }; break;
      case 'authority-rung': v.operatorRung = e.to; break;
      case 'authority-latch-raise': {
        const had = latchMap.get(e.cause);
        latchMap.set(e.cause, had !== undefined && rank(had) < rank(e.cap) ? had : e.cap); break;
      }
      case 'authority-latch-clear': latchMap.delete(e.cause); break;
      case 'authority-account-set': v.accountSet = e.to; break;
      case 'authority-model-class': v.modelClass = e.to; break;
      case 'authority-restore-confirmed':
        v.designation = e.binding.kind === 'kept'
          ? { term: e.term, sessionId: e.binding.sessionId, generation: e.binding.generation }
          : { term: e.term, sessionId: null, generation: null };
        v.operatorRung = e.operatorRung;
        latchMap.clear();
        for (const l of e.latches) latchMap.set(l.cause, l.cap);
        v.accountSet = e.accountSet;
        v.modelClass = e.modelClass;
        v.lastConfirm = {
          sequence: r.sequence, epochAtConfirm: e.epochAtConfirm, privacySequenceAtConfirm: e.privacySequenceAtConfirm,
          restoreGeneration: e.restoreGeneration,
        };
        break;
    }
  }
  return { ...v, latches: latchMap };
}
