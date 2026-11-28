// The Overlord act journal's grammar, its format on the chained kernel, and the fold of its records (Overlord spec §7.6 and
// §10.1, H27; plan `docs/superpowers/plans/2026-11-16-overlord-w2/w2-act-journal.md` Task A1, questions 1 to 3). Ring L1,
// context C5: no fs, no clock, no randomness. The second chained journal on W1's kernel, after the authority journal
// (`overlordAuthority.ts`), and in its shape: closed, exact keys, every value checked. The writer that appends these records is
// `overlordActJournal.ts` (L3, Task A2).
//
// IDS, WORDS, HASHES AND TIMES ONLY (§7.6: no journal holds the operator's words). Every field is an id, a count, a kind, a state,
// a word of a closed list or hex. No record carries `summary`, `why`, a model name or any answer text: a row the restore rebuilds
// from a record reads its text empty, and its `divergedAt` says why. The one text a record holds is the actor's subject, as the
// row and the sequence line carry it (the coordinator's call 2007: a row fact, so the record can rebuild a row that says who
// acted), checked by the identity file's one reader and by its kind's shape. No refusal this grammar throws echoes a value: a
// kind or a key is named only when it is a kebab word, so a planted marker in any field never reaches a thrown message.
//
// THE RECORD KINDS ARE PREFIXED (slug `act-record-kinds-are-prefixed`): `act-intent`, `act-settle` and `act-open-request`, the
// ruling's three kinds under the journal's prefix, because the kernel has no domain tag and the kinds census holds every format's
// kinds disjoint. A one-step act appends one `act-settle` with `from: null` (slug `one-step-act-one-record`).
import { isSessionIdShape } from '../../../shared/api.js';
import { isOverlordActKind, type OverlordActKind } from '../../../shared/overlord.js';
import {
  ACTOR_KINDS, CALLER_STRENGTHS, readActorColumns, type ActorKind, type CallerStrength,
} from '../../../shared/overlord-identity.js';
import { ISOLATION_UNMEASURED, ISOLATION_WORDS } from '../../../shared/isolation.js';
import {
  isRecord, type ChainedJournalErrorCode, type ChainedJournalFormat, type ChainedJournalRecord, type JournalWhere,
} from '../chainedJournal.js';
import type { ChainedFileRead } from '../chainedJournalFile.js';

/** The journal file in `~/.ccrc`, and its quarantine directory (one path component inside it). Neither is ever in a snapshot, a
 *  backup set or a restore pair, as the authority journal's are not. */
export const OVERLORD_ACTS_BASENAME = 'overlord-acts.jsonl';
export const OVERLORD_ACTS_TORN_DIR = 'overlord-acts-torn';

// ── INTERIM (stage 1 of act journal A): the act store's record type and its three word lists ─────────────────────────────
// The one record type is act rows A's `ActJournalRecord` (`server/src/coord/overlordActs.ts`), and the three lists are its L0
// file's (`shared/overlordActs.ts`), both in #3664, not yet on `main`. Until it lands this block mirrors them, in this one place;
// stage 2 replaces the whole block with imports and `export type OverlordActRecord = ActJournalRecord` (an alias, never a second
// shape, F7), and a single-definition case then holds that no copy survives. This block never reaches a push.
const ACT_STATES = ['pending', 'done', 'refused', 'unknown', 'staged', 'effective', 'vetoed', 'voided', 'preempted', 'shadow'] as const;
type ActState = (typeof ACT_STATES)[number];
const ACT_TARGET_KINDS = ['message', 'delivery', 'request', 'note'] as const;
const ACT_TARGET_REF_KINDS = ['programme', 'session', 'item', 'ask', 'run', 'request', 'message', 'delivery', 'note'] as const;
type ActTargetRefKind = (typeof ACT_TARGET_REF_KINDS)[number];
interface ActTargetRef { readonly kind: ActTargetRefKind; readonly id: string; readonly revision: number }
type ActRecordNatural =
  | { readonly kind: 'row'; readonly target: string; readonly id: number; readonly revision: number }
  | { readonly kind: 'start'; readonly requestId: number };
interface ActRecordBody {
  readonly opKey: string; readonly actId: number; readonly act: string; readonly effect: string | null;
  readonly natural: ActRecordNatural; readonly targets: readonly ActTargetRef[]; readonly requestId: number | null;
  readonly authority: string; readonly term: number; readonly generationId: number;
  readonly actor: { readonly kind: string; readonly subject: string }; readonly identityStrength: string; readonly isolation: string;
}
type ActJournalRecord =
  | ({ readonly kind: 'act-intent' } & ActRecordBody)
  | ({ readonly kind: 'act-settle'; readonly from: 'pending' | 'unknown' | null; readonly to: ActState } & ActRecordBody)
  | { readonly kind: 'act-open-request'; readonly opKey: string; readonly requestId: number; readonly actId: number };
// ── end INTERIM ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The act store's one record type, under the journal's name (F7). */
export type OverlordActRecord = ActJournalRecord;
export type OverlordActRecordKind = OverlordActRecord['kind'];

/** Every record kind, as a TOTAL table over the union. */
export const OVERLORD_ACT_RECORD_KINDS: Readonly<Record<OverlordActRecordKind, true>> = {
  'act-intent': true, 'act-settle': true, 'act-open-request': true,
};

type RecordOf<K extends OverlordActRecordKind> = Extract<OverlordActRecord, { kind: K }>;
const keysOf = <T>(table: Readonly<Record<keyof T, true>>): readonly string[] => Object.keys(table);
const BODY = {
  opKey: true, actId: true, act: true, effect: true, natural: true, targets: true, requestId: true, authority: true, term: true,
  generationId: true, actor: true, identityStrength: true, isolation: true,
} as const;
/** Each kind's exact keys, as TOTAL tables over its record type, so a field added to a kind is a compile error here until named. */
const KEYS: { readonly [K in OverlordActRecordKind]: readonly string[] } = {
  'act-intent': keysOf<RecordOf<'act-intent'>>({ kind: true, ...BODY }),
  'act-settle': keysOf<RecordOf<'act-settle'>>({ kind: true, ...BODY, from: true, to: true }),
  'act-open-request': keysOf<RecordOf<'act-open-request'>>({ kind: true, opKey: true, requestId: true, actId: true }),
};
const ROW_NATURAL_KEYS = keysOf<Extract<ActRecordNatural, { kind: 'row' }>>({ kind: true, target: true, id: true, revision: true });
const START_NATURAL_KEYS = keysOf<Extract<ActRecordNatural, { kind: 'start' }>>({ kind: true, requestId: true });
const TARGET_KEYS = keysOf<ActTargetRef>({ kind: true, id: true, revision: true });
const ACTOR_KEYS = keysOf<RecordOf<'act-intent'>['actor']>({ kind: true, subject: true });

// ── The refusal classes and the format ───────────────────────────────────────────────────────────────────────────────

/** Every refusal of the grammar and the kernel over this journal. `code` is the kernel's word. */
export class OverlordActRecordError extends Error {
  constructor(readonly code: ChainedJournalErrorCode, detail: string, readonly where?: JournalWhere) {
    super(`overlord act journal ${code}: ${detail}${where?.line !== undefined ? ` (line ${where.line})` : ''}`);
    this.name = 'OverlordActRecordError';
  }
}
/** The canonical writer's refusal (a value outside the canonical JSON domain), its own class as every format's is. */
export class OverlordActJsonError extends Error {
  constructor(detail: string) {
    super(`overlord act journal canonical JSON: ${detail}`);
    this.name = 'OverlordActJsonError';
  }
}

function refuse(code: ChainedJournalErrorCode, detail: string): never {
  throw new OverlordActRecordError(code, detail);
}

/** The Overlord act journal as a chained-journal format, for the writer and the kinds census. */
export const OVERLORD_ACTS_FORMAT: ChainedJournalFormat<OverlordActRecord, OverlordActRecordError> = {
  kinds: Object.keys(OVERLORD_ACT_RECORD_KINDS),
  entry: (raw) => actRecordEntry(raw),
  fail: (code, detail, where) => new OverlordActRecordError(code, detail, where),
  jsonError: (detail) => new OverlordActJsonError(detail),
};

// ── The field checks ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A kebab word: what a refusal may name. Anything else is named by its place alone, so no value leaks into a message. */
const WORD_RE = /^[a-z][a-z0-9-]{0,63}$/;
const named = (v: unknown): string => (typeof v === 'string' && WORD_RE.test(v) ? JSON.stringify(v) : 'a value that is not a word');
/** The operation key (act rows A, question 6): 32 lowercase hex characters. */
const OP_KEY_RE = /^[0-9a-f]{32}$/;
/** An id carried as text (a programme's slug, a session id): printable ASCII with no space, at most 128 bytes. */
const TOKEN_RE = /^[\x21-\x7e]{1,128}$/;
/** Table 10.1a's `authority`: a word, or a word and an id (§7.5.1, §7.1.1, §9.3). */
const AUTHORITY_RE = /^(?:own|delegated|ruling:R[1-9][0-9]{0,5}|(?:operator-request|operator-command|grant|autonomy|entry):[1-9][0-9]{0,15})$/;
/** A server actor's subject, as the attribution adapter mints it (`serverActorOf`: `ccrc server: <lane>`). */
const SERVER_SUBJECT_RE = /^ccrc server: [a-z][a-z0-9-]{0,63}$/;
/** The identity file's rule for a subject, asked of its one reader (`readActorColumns`: non-empty, within `ACTOR_SUBJECT_MAX`,
 *  no control character). The other three columns are passed as words that read, so only the subject is judged. */
const subjectReads = (s: unknown): boolean => readActorColumns(s, 'session', 'attribution', 'attributed').kind === 'read';
/** The isolation word an act was taken under: a measured word, or `unmeasured` with or without its reason (§7.4). */
const ISOLATION_HELD: readonly string[] = [...ISOLATION_WORDS, 'unmeasured', ...ISOLATION_UNMEASURED.map((w) => `unmeasured:${w}`)];
const SETTLE_FROM: readonly (string | null)[] = ['pending', 'unknown', null];

function exactKeys(o: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(o)) if (!keys.includes(k)) refuse('unknown-key', `${what} has the unknown key ${named(k)}`);
  for (const k of keys) if (!Object.hasOwn(o, k)) refuse('bad-field', `${what} is missing ${JSON.stringify(k)}`);
}
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const count = (v: unknown, what: string): number => (isCount(v) ? v : refuse('bad-field', `${what} is not a non-negative safe integer`));
const positive = (v: unknown, what: string): number => (isCount(v) && v >= 1 ? v : refuse('bad-field', `${what} is not a positive safe integer`));
const countOrNull = (v: unknown, what: string): number | null => (v === null ? null : count(v, what));
function member<T extends string>(list: readonly T[], v: unknown, what: string): T {
  return typeof v === 'string' && (list as readonly string[]).includes(v) ? (v as T) : refuse('bad-field', `${what} is not one of its words`);
}
const shaped = (re: RegExp, v: unknown, what: string): string => (typeof v === 'string' && re.test(v) ? v : refuse('bad-field', `${what} is out of shape`));
const actKind = (v: unknown, what: string): OverlordActKind => (isOverlordActKind(v) ? v : refuse('bad-field', `${what} is not an act kind`));

function natural(v: unknown): ActRecordNatural {
  if (!isRecord(v)) return refuse('bad-field', 'natural is not an object');
  if (v['kind'] === 'start') {
    exactKeys(v, START_NATURAL_KEYS, 'a start natural key');
    return { kind: 'start', requestId: count(v['requestId'], 'natural.requestId') };
  }
  if (v['kind'] !== 'row') return refuse('bad-field', 'natural.kind is neither row nor start');
  exactKeys(v, ROW_NATURAL_KEYS, 'a row natural key');
  return {
    kind: 'row', target: member(ACT_TARGET_KINDS, v['target'], 'natural.target'), id: count(v['id'], 'natural.id'),
    revision: count(v['revision'], 'natural.revision'),
  };
}

/** The order of `sortedTargets` (act rows A): kind, then id, then revision. */
const targetOrder = (a: ActTargetRef, b: ActTargetRef): number =>
  a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : a.revision - b.revision;

function targets(v: unknown): ActTargetRef[] {
  if (!Array.isArray(v)) return refuse('bad-field', 'targets is not an array');
  const out: ActTargetRef[] = [];
  for (const t of v) {
    if (!isRecord(t)) return refuse('bad-field', 'targets holds a value that is not a {kind, id, revision} triple');
    exactKeys(t, TARGET_KEYS, 'a target');
    const ref: ActTargetRef = {
      kind: member(ACT_TARGET_REF_KINDS, t['kind'], 'target kind'), id: shaped(TOKEN_RE, t['id'], 'target id'),
      revision: count(t['revision'], 'target revision'),
    };
    if (out.length > 0 && targetOrder(out[out.length - 1]!, ref) > 0) return refuse('bad-field', 'targets are not sorted');
    out.push(ref);
  }
  return out;
}

function actor(v: unknown): { kind: ActorKind; subject: string } {
  if (!isRecord(v)) return refuse('bad-field', 'actor is not an object');
  exactKeys(v, ACTOR_KEYS, 'the actor');
  const kind = member(ACTOR_KINDS, v['kind'], 'actor.kind');
  const s = v['subject'];
  const shapeHolds = kind === 'session' ? typeof s === 'string' && isSessionIdShape(s) : kind === 'server' ? typeof s === 'string' && SERVER_SUBJECT_RE.test(s) : true;
  if (!subjectReads(s) || !shapeHolds) return refuse('bad-field', `the ${kind} actor's subject is out of shape`);
  return { kind, subject: s as string };
}

function body(raw: Record<string, unknown>): ActRecordBody {
  const effect = raw['effect'];
  return {
    opKey: shaped(OP_KEY_RE, raw['opKey'], 'opKey'), actId: positive(raw['actId'], 'actId'), act: actKind(raw['act'], 'act'),
    effect: effect === null ? null : actKind(effect, 'effect'), natural: natural(raw['natural']), targets: targets(raw['targets']),
    requestId: countOrNull(raw['requestId'], 'requestId'), authority: shaped(AUTHORITY_RE, raw['authority'], 'authority'),
    term: count(raw['term'], 'term'), generationId: count(raw['generationId'], 'generationId'), actor: actor(raw['actor']),
    identityStrength: member<CallerStrength>(CALLER_STRENGTHS, raw['identityStrength'], 'identityStrength'),
    isolation: member(ISOLATION_HELD, raw['isolation'], 'isolation'),
  };
}

/** One record rebuilt field by field, or an `OverlordActRecordError`. A kind of another journal is refused naming the kind. */
export function actRecordEntry(raw: unknown): OverlordActRecord {
  if (!isRecord(raw)) return refuse('bad-field', 'the record is not an object');
  const k = raw['kind'];
  if (typeof k !== 'string' || !Object.hasOwn(OVERLORD_ACT_RECORD_KINDS, k)) {
    return refuse('bad-field', `the record kind ${named(k)} is not an Overlord act kind`);
  }
  const kind = k as OverlordActRecordKind;
  exactKeys(raw, KEYS[kind], `an ${kind} record`);
  switch (kind) {
    case 'act-intent':
      return { kind, ...body(raw) };
    case 'act-settle': {
      const from = raw['from'];
      if (!SETTLE_FROM.includes(from as string | null)) return refuse('bad-field', 'from is not pending, unknown or null');
      return { kind, ...body(raw), from: from as 'pending' | 'unknown' | null, to: member(ACT_STATES, raw['to'], 'to') };
    }
    case 'act-open-request':
      return {
        kind, opKey: shaped(OP_KEY_RE, raw['opKey'], 'opKey'), requestId: count(raw['requestId'], 'requestId'),
        actId: positive(raw['actId'], 'actId'),
      };
  }
}

// ── The writer's canonical form ──────────────────────────────────────────────────────────────────────────────────────

/** The canonical form a writer appends, before the grammar judges it: targets sorted (`sortedTargets`' order) and every key in
 *  the grammar's order, so two equal records are equal bytes. Values are carried as they came, for the grammar to refuse; a
 *  non-array `targets` is left for it too. */
export function canonicalActRecord(raw: OverlordActRecord): OverlordActRecord {
  if (raw.kind === 'act-open-request') return { kind: raw.kind, opKey: raw.opKey, requestId: raw.requestId, actId: raw.actId };
  const a = raw.actor;
  const held: ActRecordBody = {
    opKey: raw.opKey, actId: raw.actId, act: raw.act, effect: raw.effect, natural: raw.natural,
    targets: Array.isArray(raw.targets) ? [...raw.targets].sort(targetOrder) : raw.targets, requestId: raw.requestId,
    authority: raw.authority, term: raw.term, generationId: raw.generationId,
    actor: isRecord(a) ? { kind: a.kind, subject: a.subject } : a, identityStrength: raw.identityStrength, isolation: raw.isolation,
  };
  return raw.kind === 'act-intent' ? { kind: raw.kind, ...held } : { kind: raw.kind, ...held, from: raw.from, to: raw.to };
}

// ── The fold ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** What the journal says about acts and requests: per act its last intent or settle record and that record's sequence; the
 *  highest act id and request id any record names; and how many `act-settle` records the file holds (the epoch's act term,
 *  question 5, slug `act-term-counts-the-whole-file`). An empty journal reads zeros. */
export interface ActJournalView {
  readonly acts: ReadonlyMap<number, { readonly last: Exclude<OverlordActRecord, { kind: 'act-open-request' }>; readonly sequence: number }>;
  readonly highestActId: number;
  readonly highestRequestId: number;
  readonly settleCount: number;
}

/** The records folded in order. An `act-open-request` names its act and its request but is no state of the act, so it moves
 *  the highest ids only. The request floor reads every request id a record names (an act's request, a start's request and an
 *  opened request), so no id the journal knows of is ever reissued after a restore. */
export function actJournalFold(records: readonly ChainedJournalRecord<OverlordActRecord>[]): ActJournalView {
  const acts = new Map<number, { last: Exclude<OverlordActRecord, { kind: 'act-open-request' }>; sequence: number }>();
  let highestActId = 0;
  let highestRequestId = 0;
  let settleCount = 0;
  for (const r of records) {
    const e = r.entry;
    highestActId = Math.max(highestActId, e.actId);
    if (e.kind === 'act-open-request') {
      highestRequestId = Math.max(highestRequestId, e.requestId);
      continue;
    }
    if (e.requestId !== null) highestRequestId = Math.max(highestRequestId, e.requestId);
    if (e.natural.kind === 'start') highestRequestId = Math.max(highestRequestId, e.natural.requestId);
    if (e.kind === 'act-settle') settleCount += 1;
    acts.set(e.actId, { last: e, sequence: r.sequence });
  }
  return { acts, highestActId, highestRequestId, settleCount };
}

/** The journal's highest ids, from one read of the file: `measured` over every complete record (a torn tail is not a record,
 *  and a record past the head row is one, so a write that appended and then lost its row never has its id taken again),
 *  `absent` for no file, `unmeasured` for a file the reader could not read or verify. Three answers, never folded: an
 *  unreadable journal is never "no acts" (point 3). The act writer passes `act` to `nextActId` on every write (the review of
 *  #3664), never only after a restore. */
export type ActJournalHighest =
  | { readonly kind: 'measured'; readonly act: number; readonly request: number }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unmeasured'; readonly why: string };
export function actJournalHighest(read: ChainedFileRead<OverlordActRecord>): ActJournalHighest {
  switch (read.kind) {
    case 'absent': return { kind: 'absent' };
    case 'records': {
      const v = actJournalFold(read.records);
      return { kind: 'measured', act: v.highestActId, request: v.highestRequestId };
    }
    case 'malformed': return { kind: 'unmeasured', why: `malformed: ${read.code}` };
    case 'unmeasured': return { kind: 'unmeasured', why: read.why };
  }
}

/** Every word this file quotes that a kebab-token census of the coordination directory meets: the record kinds and the two
 *  file names. Derived from the declared tables, so the census admits a word only from its one home. */
export const isOverlordActsKebab = (word: string): boolean =>
  Object.hasOwn(OVERLORD_ACT_RECORD_KINDS, word) || word === OVERLORD_ACTS_TORN_DIR || word === 'overlord-acts';
