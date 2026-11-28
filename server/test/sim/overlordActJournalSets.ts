// Overlord W2, act journal plan Task A1 (PR A; the floors rule is D-8217's): the mutant sets of the act journal's L1 deciders, the
// grammar's `actRecordEntry` and `actJournalFold`, each run against suite cases over a module. Registered in
// mutation-floors.test.ts's MUTANT_SETS, with a floor each in mutation-floors.json. The expected words are written out, never read
// from the code the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { buildChainedRecord, chainNext, type ChainedJournalRecord } from '../../src/chainedJournal.js';
import { OVERLORD_ACTS_FORMAT, type OverlordActRecord } from '../../src/coord/overlordActRecords.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GRAMMAR_TS = path.join(ROOT, 'server/src/coord/overlordActRecords.ts');

type Grammar = typeof import('../../src/coord/overlordActRecords.js');

export const ACT_RECORD_ENTRY_KEY = 'server/src/coord/overlordActRecords.ts#actRecordEntry';
export const ACT_JOURNAL_FOLD_KEY = 'server/src/coord/overlordActRecords.ts#actJournalFold';

type R = OverlordActRecord;
type Rec = ChainedJournalRecord<R>;
export const OP = '0123456789abcdef0123456789abcdef';
export const OPERATOR_SUBJECT = `sha256:${'a'.repeat(64)}`;
/** A well-formed body of each kind's shape: the samples every case swaps one field of. */
export const INTENT = {
  kind: 'act-intent', opKey: OP, actId: 7, act: 'acknowledge', effect: null,
  natural: { kind: 'row', target: 'message', id: 41, revision: 0 },
  targets: [{ kind: 'message', id: '41', revision: 0 }, { kind: 'session', id: 'lane-a-project-a', revision: 3 }],
  requestId: null, authority: 'operator-command:12', term: 2, generationId: 5,
  actor: { kind: 'session', subject: 'lane-a-project-a' }, identityStrength: 'attributed', isolation: 'shared-user',
} as const;
export const SETTLE = { ...INTENT, kind: 'act-settle', from: null, to: 'done' } as const;
export const OPEN = { kind: 'act-open-request', opKey: OP, requestId: 9, actId: 8 } as const;

/** Records chained from 1, built through the real kernel and the real format (the sets mutate the decider, not the format). */
export function chainActs(entries: readonly R[]): Rec[] {
  const out: Rec[] = [];
  for (const entry of entries) {
    out.push(buildChainedRecord(OVERLORD_ACTS_FORMAT, { ...chainNext(out.at(-1) ?? null), acceptedAt: '2026-11-28T10:00:00.000Z', entry }));
  }
  return out;
}

// ---------- actRecordEntry: the grammar ----------

export function actRecordEntryCases(m: Pick<Grammar, 'actRecordEntry' | 'OverlordActRecordError'>): Record<string, SuiteCase> {
  const refused = (raw: unknown): string => {
    try { m.actRecordEntry(raw); } catch (err) { return err instanceof m.OverlordActRecordError ? err.code : `other: ${String(err)}`; }
    return 'accepted';
  };
  return {
    'a well-formed intent, settle and open-request are accepted as given': () => {
      expect(m.actRecordEntry(INTENT)).toEqual(INTENT);
      expect(m.actRecordEntry(SETTLE)).toEqual(SETTLE);
      expect(m.actRecordEntry(OPEN)).toEqual(OPEN);
    },
    'a kind of another journal is refused, naming the kind': () => {
      let err: unknown = null;
      try { m.actRecordEntry({ ...OPEN, kind: 'authority-rung' }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(m.OverlordActRecordError);
      expect((err as Error).message).toContain('"authority-rung"');
    },
    'a missing key is bad-field, and an unknown key unknown-key, in every kind': () => {
      const { requestId: _r, ...noRequest } = INTENT;
      expect([refused(noRequest), refused({ ...SETTLE, extra: 1 }), refused({ ...OPEN, summary: '' })]).toEqual(['bad-field', 'unknown-key', 'unknown-key']);
      const { to: _t, ...noTo } = SETTLE;
      expect(refused(noTo)).toBe('bad-field');
      expect(refused({ ...INTENT, from: null, to: 'done' })).toBe('unknown-key');
    },
    'the operation key is 32 lowercase hex characters': () => {
      expect([refused({ ...OPEN, opKey: OP.toUpperCase() }), refused({ ...OPEN, opKey: OP.slice(1) }), refused({ ...OPEN, opKey: `${OP}0` })])
        .toEqual(['bad-field', 'bad-field', 'bad-field']);
    },
    'an act id is a positive safe integer, a request id and a revision non-negative': () => {
      expect([refused({ ...OPEN, actId: 0 }), refused({ ...OPEN, actId: 1.5 }), refused({ ...OPEN, actId: '8' }), refused({ ...OPEN, requestId: -1 }),
        refused({ ...OPEN, requestId: 0 })]).toEqual(['bad-field', 'bad-field', 'bad-field', 'bad-field', 'accepted']);
      expect([refused({ ...INTENT, requestId: 3 }), refused({ ...INTENT, requestId: -3 }), refused({ ...INTENT, term: -1 }),
        refused({ ...INTENT, generationId: 2.5 })]).toEqual(['accepted', 'bad-field', 'bad-field', 'bad-field']);
    },
    'the act and the effect are act kinds, and the effect may be null': () => {
      expect([refused({ ...INTENT, act: 'no-such-act' }), refused({ ...INTENT, effect: 'widen-scope' }), refused({ ...INTENT, effect: 'nope' }),
        refused({ ...INTENT, act: null })]).toEqual(['bad-field', 'accepted', 'bad-field', 'bad-field']);
    },
    'the natural key is a row of a target kind or a start of a request': () => {
      const nat = (natural: unknown): string => refused({ ...INTENT, natural });
      expect([nat({ kind: 'start', requestId: 4 }), nat({ kind: 'row', target: 'session', id: 1, revision: 0 }),
        nat({ kind: 'row', target: 'note', id: 1, revision: -1 }), nat({ kind: 'other', requestId: 4 }), nat({ kind: 'start', requestId: 4, id: 1 }),
        nat({ kind: 'row', target: 'note', id: 1 }), nat('start')]).toEqual(['accepted', 'bad-field', 'bad-field', 'bad-field', 'unknown-key', 'bad-field', 'bad-field']);
    },
    'targets are sorted triples of a target kind, a token id and a revision': () => {
      const tg = (targets: unknown): string => refused({ ...INTENT, targets });
      expect([tg([]), tg([{ kind: 'session', id: 'a', revision: 0 }, { kind: 'message', id: '41', revision: 0 }]),
        tg([{ kind: 'session', id: 'a b', revision: 0 }]), tg([{ kind: 'thing', id: 'a', revision: 0 }]), tg([{ kind: 'run', id: 'a', revision: 0, x: 1 }]),
        tg([{ kind: 'run', id: '', revision: 0 }]), tg('run'), tg([{ kind: 'run', id: 'a', revision: 1 }, { kind: 'run', id: 'a', revision: 0 }]),
        tg([{ kind: 'run', id: 'a', revision: 0 }, { kind: 'run', id: 'a', revision: 0 }])])
        .toEqual(['accepted', 'bad-field', 'bad-field', 'bad-field', 'unknown-key', 'bad-field', 'bad-field', 'bad-field', 'accepted']);
    },
    'the authority is a word or a word and an id': () => {
      const au = (authority: unknown): string => refused({ ...INTENT, authority });
      expect([au('own'), au('delegated'), au('ruling:R22'), au('grant:3'), au('autonomy:9'), au('entry:1'), au('operator-request:5'),
        au('grant:0'), au('grant:x'), au('owner'), au('own '), au('because the operator said so')])
        .toEqual(['accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'accepted', 'bad-field', 'bad-field', 'bad-field', 'bad-field', 'bad-field']);
    },
    'an operator subject is opaque text within the identity bound, a server subject is the lane form, a session subject a session id': () => {
      const ac = (actor: unknown): string => refused({ ...INTENT, actor });
      expect([ac({ kind: 'operator', subject: OPERATOR_SUBJECT }), ac({ kind: 'operator', subject: 'device:phone' }),
        ac({ kind: 'operator', subject: '' }), ac({ kind: 'operator', subject: 'x'.repeat(201) }), ac({ kind: 'operator', subject: 'x'.repeat(200) }),
        ac({ kind: 'operator', subject: 'tab\there' }), ac({ kind: 'operator', subject: 7 }),
        ac({ kind: 'server', subject: 'ccrc server: act-head-sign' }), ac({ kind: 'server', subject: 'ccrc server: Two Words' }),
        ac({ kind: 'session', subject: 'lane-a-project-a' }), ac({ kind: 'session', subject: 'a b' }), ac({ kind: 'robot', subject: 'x' }),
        ac({ kind: 'session', subject: 'lane-a-project-a', issuer: 'attribution' })])
        .toEqual(['accepted', 'accepted', 'bad-field', 'bad-field', 'accepted', 'bad-field', 'bad-field', 'accepted', 'bad-field', 'accepted',
          'bad-field', 'bad-field', 'unknown-key']);
    },
    'the strength and the isolation are words of their lists': () => {
      expect([refused({ ...INTENT, identityStrength: 'operator' }), refused({ ...INTENT, identityStrength: 'strong' }),
        refused({ ...INTENT, isolation: 'separate-host' }), refused({ ...INTENT, isolation: 'unmeasured' }),
        refused({ ...INTENT, isolation: 'unmeasured:link-down' }), refused({ ...INTENT, isolation: 'unmeasured:why-not' }),
        refused({ ...INTENT, isolation: 'isolated' })]).toEqual(['accepted', 'bad-field', 'accepted', 'accepted', 'accepted', 'bad-field', 'bad-field']);
    },
    'a settle moves from pending, unknown or nothing to an act state': () => {
      expect([refused({ ...SETTLE, from: 'pending', to: 'refused' }), refused({ ...SETTLE, from: 'unknown', to: 'done' }),
        refused({ ...SETTLE, from: 'done' }), refused({ ...SETTLE, to: 'finished' }), refused({ ...SETTLE, from: undefined })])
        .toEqual(['accepted', 'accepted', 'bad-field', 'bad-field', 'bad-field']);
    },
  };
}

const ENTRY_SET: MutantSet<Grammar> = {
  modulePath: GRAMMAR_TS,
  mutants: [
    { id: 'G1 any kind', old: "if (typeof k !== 'string' || !Object.hasOwn(OVERLORD_ACT_RECORD_KINDS, k)) {", new: "if (typeof k !== 'string') {" },
    { id: 'G2 no exact keys', old: 'exactKeys(raw, KEYS[kind], `an ${kind} record`);', new: ';' },
    { id: 'G3 any op key', old: 'const OP_KEY_RE = /^[0-9a-f]{32}$/;', new: 'const OP_KEY_RE = /^[0-9a-fA-F]{31,33}$/;' },
    { id: 'G4 act id 0', old: "(isCount(v) && v >= 1 ? v : refuse('bad-field', `${what} is not a positive", new: "(isCount(v) && v >= 0 ? v : refuse('bad-field', `${what} is not a positive" },
    { id: 'G5 any natural kind', old: "if (v['kind'] !== 'row') return refuse('bad-field', 'natural.kind is neither row nor start');", new: '' },
    { id: 'G6 unsorted targets', old: 'if (out.length > 0 && targetOrder(out[out.length - 1]!, ref) > 0)', new: 'if (false)' },
    { id: 'G7 a space in a token', old: 'const TOKEN_RE = /^[\\x21-\\x7e]{1,128}$/;', new: 'const TOKEN_RE = /^[\\x20-\\x7e]{0,128}$/;' },
    { id: 'G8 any authority', old: "authority: shaped(AUTHORITY_RE, raw['authority'], 'authority')", new: "authority: raw['authority'] as string" },
    { id: 'G9 any subject text', old: 'if (!subjectReads(s) || !shapeHolds) return refuse', new: 'if (!shapeHolds) return refuse' },
    { id: 'G10 any server subject', old: ": kind === 'server' ? typeof s === 'string' && SERVER_SUBJECT_RE.test(s) : true;", new: ': true;' },
    { id: 'G21 any session subject', old: "kind === 'session' ? typeof s === 'string' && isSessionIdShape(s) : ", new: '' },
    { id: 'G11 any effect', old: "effect: effect === null ? null : actKind(effect, 'effect')", new: 'effect: effect as string | null' },
    { id: 'G12 any settle from', old: "if (!SETTLE_FROM.includes(from as string | null)) return refuse", new: 'if (false) return refuse' },
    { id: 'G13 any isolation', old: "isolation: member(ISOLATION_HELD, raw['isolation'], 'isolation')", new: "isolation: raw['isolation'] as string" },
    { id: 'G14 any strength', old: "identityStrength: member<CallerStrength>(CALLER_STRENGTHS, raw['identityStrength'], 'identityStrength')", new: "identityStrength: raw['identityStrength'] as string" },
    { id: 'G15 negative request id', old: "const countOrNull = (v: unknown, what: string): number | null => (v === null ? null : count(v, what));", new: "const countOrNull = (v: unknown, what: string): number | null => (v === null ? null : (v as number));" },
    { id: 'G16 any target kind', old: "kind: member(ACT_TARGET_REF_KINDS, t['kind'], 'target kind')", new: "kind: t['kind'] as ActTargetRefKind" },
    { id: 'G17 any natural target', old: "target: member(ACT_TARGET_KINDS, v['target'], 'natural.target')", new: "target: v['target'] as string" },
    { id: 'G18 any act', old: "act: actKind(raw['act'], 'act')", new: "act: raw['act'] as string" },
    { id: 'G19 any settle state', old: "to: member(ACT_STATES, raw['to'], 'to')", new: "to: raw['to'] as ActState" },
    { id: 'G20 any actor kind', old: "const kind = member(ACTOR_KINDS, v['kind'], 'actor.kind');", new: "const kind = v['kind'] as ActorKind;" },
  ],
  suite: (mod) => actRecordEntryCases(mod),
};

// ---------- actJournalFold: the fold ----------

export function actJournalFoldCases(m: Pick<Grammar, 'actJournalFold'>): Record<string, SuiteCase> {
  return {
    'an empty journal reads no act, zero highest ids and no settle': () => {
      const v = m.actJournalFold([]);
      expect([v.acts.size, v.highestActId, v.highestRequestId, v.settleCount]).toEqual([0, 0, 0, 0]);
    },
    'an intent then its settle: the act\'s last record is the settle, at its sequence, and one settle is counted': () => {
      const v = m.actJournalFold(chainActs([{ ...INTENT, actId: 3 }, { ...SETTLE, actId: 3, from: 'pending', to: 'refused' }] as R[]));
      expect(v.acts.size).toBe(1);
      expect(v.acts.get(3)).toMatchObject({ sequence: 2, last: { kind: 'act-settle', from: 'pending', to: 'refused' } });
      expect(v.settleCount).toBe(1);
    },
    'a one-step settle alone is one act, and an intent alone counts no settle': () => {
      const one = m.actJournalFold(chainActs([{ ...SETTLE, actId: 4 }] as R[]));
      expect([one.acts.get(4)?.sequence, one.acts.get(4)?.last.kind, one.settleCount]).toEqual([1, 'act-settle', 1]);
      const two = m.actJournalFold(chainActs([{ ...INTENT, actId: 4 }] as R[]));
      expect([two.acts.get(4)?.last.kind, two.settleCount]).toEqual(['act-intent', 0]);
    },
    'the highest act and request ids are the largest any record names, an open-request included, and it is no act state': () => {
      const v = m.actJournalFold(chainActs([
        { ...SETTLE, actId: 9, requestId: 2 }, { ...SETTLE, actId: 5, requestId: null, natural: { kind: 'start', requestId: 6 } },
        { ...OPEN, actId: 11, requestId: 4 }, { ...INTENT, actId: 10 },
      ] as R[]));
      expect([v.highestActId, v.highestRequestId, v.settleCount]).toEqual([11, 6, 2]);
      expect([...v.acts.keys()].sort((a, b) => a - b)).toEqual([5, 9, 10]);
    },
    'an act\'s own request above every other is the highest request id': () => {
      const v = m.actJournalFold(chainActs([{ ...INTENT, actId: 1, requestId: 12 }, { ...OPEN, actId: 1, requestId: 3 }] as R[]));
      expect(v.highestRequestId).toBe(12);
    },
    'an opened request above every other is the highest request id': () => {
      const v = m.actJournalFold(chainActs([{ ...SETTLE, actId: 2, requestId: 3 }, { ...OPEN, actId: 2, requestId: 8 }] as R[]));
      expect([v.highestActId, v.highestRequestId]).toEqual([2, 8]);
    },
    'two settles of two acts count two, and a later record of an act replaces its earlier one': () => {
      const v = m.actJournalFold(chainActs([
        { ...INTENT, actId: 1 }, { ...SETTLE, actId: 2 }, { ...SETTLE, actId: 1, from: 'pending', to: 'unknown' },
        { ...SETTLE, actId: 1, from: 'unknown', to: 'done' },
      ] as R[]));
      expect(v.settleCount).toBe(3);
      expect(v.acts.get(1)).toMatchObject({ sequence: 4, last: { from: 'unknown', to: 'done' } });
      expect(v.acts.get(2)?.sequence).toBe(2);
    },
  };
}

const FOLD_SET: MutantSet<Grammar> = {
  modulePath: GRAMMAR_TS,
  mutants: [
    { id: 'F1 settles uncounted', old: "if (e.kind === 'act-settle') settleCount += 1;", new: '' },
    { id: 'F2 intents counted', old: "if (e.kind === 'act-settle') settleCount += 1;", new: 'settleCount += 1;' },
    { id: 'F3 an open-request is a state', old: '      highestRequestId = Math.max(highestRequestId, e.requestId);\n      continue;', new: '      highestRequestId = Math.max(highestRequestId, e.requestId);' },
    { id: 'F4 open-request act id ignored', old: '    highestActId = Math.max(highestActId, e.actId);\n    if (e.kind', new: "    if (e.kind !== 'act-open-request') highestActId = Math.max(highestActId, e.actId);\n    if (e.kind" },
    { id: 'F5 opened request ignored', old: "    if (e.kind === 'act-open-request') {\n      highestRequestId = Math.max(highestRequestId, e.requestId);", new: "    if (e.kind === 'act-open-request') {" },
    { id: 'F6 start request ignored', old: "if (e.natural.kind === 'start') highestRequestId = Math.max(highestRequestId, e.natural.requestId);", new: '' },
    { id: 'F7 act request ignored', old: 'if (e.requestId !== null) highestRequestId = Math.max(highestRequestId, e.requestId);', new: '' },
    { id: 'F8 first record kept', old: 'acts.set(e.actId, { last: e, sequence: r.sequence });', new: 'if (!acts.has(e.actId)) acts.set(e.actId, { last: e, sequence: r.sequence });' },
    { id: 'F9 last id not highest', old: 'highestActId = Math.max(highestActId, e.actId);', new: 'highestActId = e.actId;' },
  ],
  suite: (mod) => actJournalFoldCases(mod),
};

// ---------- actJournalHighest: the writer's highest ids, three answers ----------

export function actJournalHighestCases(m: Pick<Grammar, 'actJournalHighest'>): Record<string, SuiteCase> {
  const recs = (entries: readonly R[]) => ({ kind: 'records' as const, records: chainActs(entries), tail: null });
  return {
    'no file is absent, never a measured zero': () => { expect(m.actJournalHighest({ kind: 'absent' })).toEqual({ kind: 'absent' }); },
    'an empty file of no record is measured zero': () => {
      expect(m.actJournalHighest(recs([]))).toEqual({ kind: 'measured', act: 0, request: 0 });
    },
    'a gap in the act ids reads the highest, not the count': () => {
      expect(m.actJournalHighest(recs([{ ...SETTLE, actId: 2 }, { ...SETTLE, actId: 9, requestId: 4 }] as R[])))
        .toEqual({ kind: 'measured', act: 9, request: 4 });
    },
    'a trailing record (a write whose row was lost) is counted, so its id is never taken again': () => {
      expect(m.actJournalHighest(recs([{ ...SETTLE, actId: 3 }, { ...INTENT, actId: 4 }] as R[]))).toMatchObject({ kind: 'measured', act: 4 });
    },
    'a torn tail is no record': () => {
      const read = { ...recs([{ ...SETTLE, actId: 3 }] as R[]), tail: { offset: 10, bytes: new Uint8Array([123]) } };
      expect(m.actJournalHighest(read as never)).toMatchObject({ kind: 'measured', act: 3 });
    },
    'a malformed file and an unreadable one are unmeasured, with their word': () => {
      expect(m.actJournalHighest({ kind: 'malformed', code: 'digest-mismatch', detail: 'x', lines: 3 }))
        .toEqual({ kind: 'unmeasured', why: 'malformed: digest-mismatch' });
      expect(m.actJournalHighest({ kind: 'unmeasured', why: 'unreadable' })).toEqual({ kind: 'unmeasured', why: 'unreadable' });
    },
  };
}

const HIGHEST_SET: MutantSet<Grammar> = {
  modulePath: GRAMMAR_TS,
  mutants: [
    { id: 'H1 absent is zero', old: "case 'absent': return { kind: 'absent' };", new: "case 'absent': return { kind: 'measured', act: 0, request: 0 };" },
    { id: 'H2 malformed is zero', old: "case 'malformed': return { kind: 'unmeasured', why: `malformed: ${read.code}` };", new: "case 'malformed': return { kind: 'measured', act: 0, request: 0 };" },
    { id: 'H3 unreadable is absent', old: "case 'unmeasured': return { kind: 'unmeasured', why: read.why };", new: "case 'unmeasured': return { kind: 'absent' };" },
    { id: 'H4 the count, not the highest', old: "return { kind: 'measured', act: v.highestActId, request: v.highestRequestId };", new: "return { kind: 'measured', act: v.acts.size, request: v.highestRequestId };" },
  ],
  suite: (mod) => actJournalHighestCases(mod),
};

export const ACT_JOURNAL_HIGHEST_KEY = 'server/src/coord/overlordActRecords.ts#actJournalHighest';
export const OVERLORD_ACT_JOURNAL_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [ACT_RECORD_ENTRY_KEY]: ENTRY_SET as MutantSet<never>,
  [ACT_JOURNAL_FOLD_KEY]: FOLD_SET as MutantSet<never>,
  [ACT_JOURNAL_HIGHEST_KEY]: HIGHEST_SET as MutantSet<never>,
};
